# 🖊️ Guía Completa: Firma Masiva de PDFs con Stirling-PDF API desde PHP/CodeIgniter 4

## Índice

1. [Resumen del Objetivo](#resumen)
2. [Arquitectura de la Solución](#arquitectura)
3. [Endpoints Disponibles](#endpoints)
4. [Estrategia A: Pipeline (Recomendada)](#estrategia-a)
5. [Estrategia B: Bucle Individual + ZIP en PHP](#estrategia-b)
6. [Parámetros del Endpoint add-stamp](#parametros)
7. [Cómo Calcular Coordenadas y Tamaño](#coordenadas)
8. [Implementación Completa en PHP/CI4](#implementacion)
9. [Solución de Problemas](#troubleshooting)
10. [Separar Páginas en Archivos Individuales + Renombrar](#separar-paginas)
11. [Renombrar PDFs por Campo](#renombrar)
12. [Cifrar PDFs por Campo](#cifrar)
13. [OCR para PDFs sin texto (nóminas escaneadas)](#ocr)

---

## 1. Resumen del Objetivo <a name="resumen"></a>

| Elemento       | Detalle                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| **Servidor 1** | Tu proyecto PHP 8.2+ + CodeIgniter 4 (cliente)                               |
| **API**        | Stirling-PDF corriendo en `http://localhost:8080` (o el host que configures) |
| **Entrada**    | 50 archivos PDF + 1 imagen JPG (firma+sello)                                 |
| **Salida**     | 50 archivos PDF firmados, empaquetados en un `.zip`                          |
| **Objetivo**   | Automatizar todo en una sola acción, sin procesar uno por uno manualmente    |

---

## 2. Arquitectura de la Solución <a name="arquitectura"></a>

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Servidor 1 (PHP/CodeIgniter 4)                       │
│                                                                         │
│  1. Usuario sube N PDFs + 1 imagen de firma                            │
│  2. PHP envía CADA PDF individualmente a Stirling-PDF (en paralelo)    │
│  3. Stirling-PDF firma cada PDF y devuelve el binario resultante        │
│  4. PHP empaqueta todos los PDFs firmados en un ZIP                    │
│  5. PHP sirve el ZIP al usuario para descarga                           │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ POST multipart/form-data (1 petición por PDF)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Stirling-PDF                                │
│                                                                         │
│  Opción A: POST /api/v1/pipeline/handleData                             │
│            → Procesamiento en lote con JSON de configuración            │
│            → NO soporta archivos binarios como parámetros               │
│            → No viable para stamps de imagen (ver sección 4)           │
│                                                                         │
│  Opción B (IMPLEMENTADA): POST /api/v1/misc/add-stamp (por cada PDF)   │
│            → SISO: 1 PDF entrada → 1 PDF firmado salida                │
│            → Soporta stampImage como archivo binario                   │
│            → PHP empaqueta resultados en ZIP con curl_multi paralelo   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Endpoints Disponibles <a name="endpoints"></a>

| Endpoint                          | Método | Tipo                        | Descripción                                                              |
| --------------------------------- | ------ | --------------------------- | ------------------------------------------------------------------------ |
| `/api/v1/misc/add-stamp`          | POST   | SISO (1 entrada → 1 salida) | Agrega un stamp (texto o imagen) a UN PDF                                |
| `/api/v1/pipeline/handleData`     | POST   | MIMO (N entradas → ZIP)     | Ejecuta operaciones en lote sobre múltiples PDFs                         |
| `/api/v1/general/split-by-size-or-count`  | POST   | SIMO (1 entrada → ZIP)      | Separa un PDF en múltiples archivos (por tamaño, páginas o cantidad)     |
| `/api/v1/misc/rename-pdfs`        | POST   | MIMO (N entradas → ZIP)     | Renombra múltiples PDFs por texto fijo o por campo/etiqueta del PDF      |
| `/api/v1/security/encrypt-pdfs`   | POST   | MIMO (N entradas → ZIP)     | Cifra múltiples PDFs con contraseña fija o leída desde cada PDF          |

> [!IMPORTANT]
> El endpoint **pipeline** es la forma más eficiente porque envías todos los archivos en UNA sola petición HTTP y recibes UN solo ZIP.
>
> Sin embargo, **el pipeline no soporta enviar archivos binarios como parámetros** (como la imagen de firma). Los parámetros de la pipeline se pasan como JSON con valores primitivos. Por lo tanto, **la imagen de firma DEBE enviarse como un parámetro del formulario multipart** o usarse la Estrategia B.

---

## 4. Estrategia A: Pipeline (1 solo request) <a name="estrategia-a"></a>

### ⚠️ Limitación Importante del Pipeline

El pipeline de Stirling-PDF funciona así:

1. Recibe archivos + un JSON con la configuración de operaciones
2. Para cada operación, itera sobre cada archivo y llama **internamente** al endpoint correspondiente
3. Los parámetros se pasan como `Map<String, Object>` desde el JSON

**El problema**: El parámetro `stampImage` del endpoint `/api/v1/misc/add-stamp` es de tipo `MultipartFile` (archivo binario). El pipeline pasa los parámetros como valores del JSON, lo cual NO soporta archivos binarios.

> [!CAUTION]
> **El pipeline NO puede pasar la imagen de firma como parámetro.** Esto hace que la **Estrategia B sea la recomendada** para tu caso de uso.

### Si quisieras usar el Pipeline (sólo con stamps tipo `text`):

```
POST /api/v1/pipeline/handleData
Content-Type: multipart/form-data

Campos del formulario:
- fileInput[]: archivo1.pdf
- fileInput[]: archivo2.pdf
- ... (hasta 50 archivos)
- json: (string JSON con la configuración)
```

**JSON de ejemplo (sólo stamp tipo texto):**

```json
{
  "name": "Firmar-documentos",
  "pipeline": [
    {
      "operation": "/api/v1/misc/add-stamp",
      "parameters": {
        "stampType": "text",
        "stampText": "FIRMADO - @date",
        "pageNumbers": "all",
        "position": 1,
        "fontSize": 12,
        "rotation": 0,
        "opacity": 1.0,
        "overrideX": -1,
        "overrideY": -1,
        "customMargin": "medium",
        "customColor": "#000000",
        "alphabet": "roman"
      }
    }
  ]
}
```

---

## 5. Estrategia B: Bucle Individual + ZIP en PHP (RECOMENDADA) <a name="estrategia-b"></a>

Esta estrategia es la **obligatoria para stamps de tipo `image`** (tu caso), ya que necesitas enviar el archivo de imagen.

### Flujo:

1. PHP recibe los 50 PDFs + la imagen de firma del usuario
2. PHP itera sobre cada PDF
3. Para cada PDF, hace un `POST multipart/form-data` a `/api/v1/misc/add-stamp`
4. Recibe el PDF firmado como respuesta binaria
5. Lo guarda temporalmente en el servidor
6. Al terminar, empaqueta los 50 PDFs en un ZIP
7. Sirve el ZIP al usuario

---

## 6. Parámetros del Endpoint `/api/v1/misc/add-stamp` <a name="parametros"></a>

### Todos los parámetros (multipart/form-data):

| Parámetro      | Tipo             | Obligatorio             | Valor por defecto     | Descripción                                                                                                                      |
| -------------- | ---------------- | ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `fileInput`    | `file` (PDF)     | ✅ Sí                   | —                     | El archivo PDF a firmar                                                                                                          |
| `stampType`    | `string`         | ✅ Sí                   | —                     | `"image"` para imagen de firma, `"text"` para texto                                                                              |
| `stampImage`   | `file` (JPG/PNG) | ✅ Si `stampType=image` | —                     | La imagen con la firma y/o sello                                                                                                 |
| `stampText`    | `string`         | Si `stampType=text`     | `"Stirling Software"` | Texto del stamp                                                                                                                  |
| `pageNumbers`  | `string`         | ✅ Sí                   | `"all"`               | Páginas donde aplicar: `"all"`, `"1"`, `"1,3,5"`, `"1-5"`                                                                        |
| `fontSize`     | `float`          | ✅ Sí                   | `40`                  | **Altura de la imagen en puntos PDF** (1 punto = 1/72 de pulgada). El ancho se calcula automáticamente manteniendo la proporción |
| `rotation`     | `float`          | ✅ Sí                   | `0`                   | Rotación en grados                                                                                                               |
| `opacity`      | `float`          | ✅ Sí                   | `0.5`                 | Opacidad: `0.0` (invisible) a `1.0` (opaco)                                                                                      |
| `position`     | `int`            | ✅ Sí                   | `8`                   | Posición en cuadrícula 1-9 (ver diagrama abajo)                                                                                  |
| `overrideX`    | `float`          | ✅ Sí                   | `-1`                  | Coordenada X exacta. `-1` = usar la posición de cuadrícula                                                                       |
| `overrideY`    | `float`          | ✅ Sí                   | `-1`                  | Coordenada Y exacta. `-1` = usar la posición de cuadrícula                                                                       |
| `customMargin` | `string`         | ✅ Sí                   | `"medium"`            | Margen: `"small"`, `"medium"`, `"large"`, `"x-large"`                                                                            |
| `customColor`  | `string`         | No                      | `"#d3d3d3"`           | Color del texto (sólo para `stampType=text`)                                                                                     |
| `alphabet`     | `string`         | No                      | `"roman"`             | Alfabeto: `"roman"`, `"arabic"`, `"japanese"`, `"korean"`, `"chinese"`, `"thai"`                                                 |

### Diagrama de Posiciones (cuadrícula 1-9):

```
┌───────────────────────────────────────┐
│                                       │
│   1 (top-left)   2 (top-center)   3   │  ← Parte superior
│                                       │
│   4 (mid-left)   5 (center)       6   │  ← Centro
│                                       │
│   7 (bot-left)   8 (bot-center)   9   │  ← Parte inferior
│                                       │
└───────────────────────────────────────┘
```

> [!TIP]
> Para una firma, la posición más común es **7** (abajo-izquierda) o **9** (abajo-derecha). La posición **1** corresponde a la esquina superior-izquierda.

---

## 7. Cómo Calcular Coordenadas y Tamaño <a name="coordenadas"></a>

### Sistema de Coordenadas PDF

- El origen `(0, 0)` está en la **esquina inferior-izquierda** de la página
- Las unidades son **puntos PDF** (1 punto = 1/72 de pulgada ≈ 0.353 mm)
- Una página **carta** (Letter) es `612 × 792` puntos (8.5 × 11 pulgadas)
- Una página **A4** es `595 × 842` puntos (210 × 297 mm)

### El parámetro `fontSize` controla la altura

```
fontSize = altura deseada de la imagen de firma en puntos PDF

Conversiones útiles:
- 1 cm ≈ 28.35 puntos
- 1 pulgada = 72 puntos
- 1 mm ≈ 2.835 puntos
```

**Ejemplo**: Si quieres que tu firma mida **3 cm de alto**:

```
fontSize = 3 × 28.35 = 85 puntos
```

El **ancho se calcula automáticamente** preservando la proporción de la imagen original.

### Cuándo usar `overrideX` y `overrideY`

- Si usas `position` (1-9): el sistema calcula X,Y automáticamente con márgenes
- Si quieres control **milimétrico**: usa `overrideX` y `overrideY`

**Ejemplo**: Firma en la esquina inferior-derecha a 2cm del borde:

```
// Página A4 (595 × 842 puntos)
// 2 cm desde el borde derecho: 595 - (2 × 28.35) - anchoFirma
// 2 cm desde el borde inferior: 2 × 28.35 = 56.7

overrideX = 400   // Ajustar según el ancho de tu firma
overrideY = 57     // 2 cm desde el borde inferior
fontSize  = 85     // 3 cm de alto
```

> [!TIP]
> **Consejo práctico**: Haz una prueba primero con UN solo PDF enviando diferentes valores de `overrideX`, `overrideY` y `fontSize` hasta que la firma quede exactamente donde quieres. Luego usa esos mismos valores para los 50 archivos.

---

## 8. Implementación Completa en PHP/CodeIgniter 4 <a name="implementacion"></a>

### 8.1. Configuración Base

Crea un archivo de configuración para la conexión a Stirling-PDF:

**`app/Config/StirlingPdf.php`**

```php
<?php

namespace Config;

use CodeIgniter\Config\BaseConfig;

class StirlingPdf extends BaseConfig
{
    /**
     * URL base de la API de Stirling-PDF
     * Ajustar según tu entorno (Docker, local, remoto)
     */
    public string $baseUrl = 'http://localhost:8080';

    /**
     * API Key (si la seguridad está habilitada en Stirling-PDF)
     * Dejar vacío si no usas autenticación
     */
    public string $apiKey = '';

    /**
     * Timeout para la petición HTTP en segundos
     * 50 archivos puede tardar, aumentar según necesidad
     */
    public int $timeout = 300; // 5 minutos

    /**
     * Timeout de conexión en segundos
     */
    public int $connectTimeout = 10;

    /**
     * Máximo de peticiones simultáneas con curl_multi.
     * Aumentar con precaución; valores altos pueden saturar Stirling-PDF.
     */
    public int $concurrency = 5;
}
```

### 8.2. Librería de Cliente para Stirling-PDF

**`app/Libraries/StirlingPdfClient.php`**

```php
<?php

namespace App\Libraries;

use CodeIgniter\HTTP\CURLRequest;
use Config\StirlingPdf;

class StirlingPdfClient
{
    private string $baseUrl;
    private string $apiKey;
    private int $timeout;
    private int $connectTimeout;

    public function __construct()
    {
        $config = new StirlingPdf();
        $this->baseUrl        = rtrim($config->baseUrl, '/');
        $this->apiKey         = $config->apiKey;
        $this->timeout        = $config->timeout;
        $this->connectTimeout = $config->connectTimeout;
    }

    /**
     * Aplicar stamp de imagen a un PDF
     *
     * @param string $pdfPath      Ruta absoluta al archivo PDF
     * @param string $imagePath    Ruta absoluta a la imagen de firma (JPG/PNG)
     * @param array  $options      Opciones de configuración del stamp
     * @return string|false        Contenido binario del PDF firmado, o false si falla
     */
    public function addImageStamp(string $pdfPath, string $imagePath, array $options = []): string|false
    {
        // Valores por defecto
        $defaults = [
            'stampType'    => 'image',
            'pageNumbers'  => 'all',
            'fontSize'     => 85,       // ~3cm de alto
            'rotation'     => 0,
            'opacity'      => 1.0,      // Completamente opaco
            'position'     => 1,        // abajo-izquierda
            'overrideX'    => -1,       // -1 = usar position
            'overrideY'    => -1,       // -1 = usar position
            'customMargin' => 'medium',
            'customColor'  => '#000000',
            'alphabet'     => 'roman',
        ];

        $params = array_merge($defaults, $options);

        // Construir el body multipart
        $multipart = [
            [
                'name'     => 'fileInput',
                'contents' => fopen($pdfPath, 'r'),
                'filename' => basename($pdfPath),
            ],
            [
                'name'     => 'stampImage',
                'contents' => fopen($imagePath, 'r'),
                'filename' => basename($imagePath),
            ],
        ];

        // Agregar todos los parámetros como campos del formulario
        foreach ($params as $key => $value) {
            $multipart[] = [
                'name'     => $key,
                'contents' => (string) $value,
            ];
        }

        // Construir el boundary manualmente
        $boundary = '----StirlingBatch' . uniqid();
        $body     = $this->buildMultipartBody($multipart, $boundary);

        // Headers
        $headers = [
            'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
        ];
        if (!empty($this->apiKey)) {
            $headers['X-API-KEY'] = $this->apiKey;
        }

        // Hacer la petición con cURL directamente para mejor control
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $this->baseUrl . '/api/v1/misc/add-stamp',
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $this->formatHeaders($headers),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
        ]);

        $response   = curl_exec($ch);
        $httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError  = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            log_message('error', "StirlingPDF cURL error: {$curlError}");
            return false;
        }

        if ($httpCode !== 200) {
            log_message('error', "StirlingPDF HTTP {$httpCode}: " . substr($response, 0, 500));
            return false;
        }

        return $response;
    }

    /**
     * Procesar múltiples PDFs y devolver un ZIP con todos firmados
     *
     * @param array  $pdfPaths     Array de rutas absolutas a archivos PDF
     * @param string $imagePath    Ruta absoluta a la imagen de firma
     * @param array  $options      Opciones de configuración del stamp
     * @param string $outputZip    Ruta donde guardar el ZIP resultante
     * @return array               ['success' => bool, 'processed' => int, 'errors' => array, 'zipPath' => string]
     */
    public function batchAddImageStamp(
        array $pdfPaths,
        string $imagePath,
        array $options = [],
        string $outputZip = ''
    ): array {
        if (empty($outputZip)) {
            $outputZip = WRITEPATH . 'uploads/firmados_' . date('Ymd_His') . '.zip';
        }

        // Asegurar que el directorio existe
        $dir = dirname($outputZip);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $results = [
            'success'   => true,
            'total'     => count($pdfPaths),
            'processed' => 0,
            'errors'    => [],
            'zipPath'   => $outputZip,
        ];

        // Crear el ZIP
        $zip = new \ZipArchive();
        if ($zip->open($outputZip, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            $results['success'] = false;
            $results['errors'][] = "No se pudo crear el archivo ZIP: {$outputZip}";
            return $results;
        }

        foreach ($pdfPaths as $index => $pdfPath) {
            $filename = basename($pdfPath);
            log_message('info', "Procesando [{$index}/" . count($pdfPaths) . "]: {$filename}");

            $stampedPdf = $this->addImageStamp($pdfPath, $imagePath, $options);

            if ($stampedPdf === false) {
                $results['errors'][] = "Error al firmar: {$filename}";
                $results['success'] = false;
                continue;
            }

            // Agregar el PDF firmado al ZIP
            $stampedFilename = pathinfo($filename, PATHINFO_FILENAME) . '_firmado.pdf';
            $zip->addFromString($stampedFilename, $stampedPdf);
            $results['processed']++;
        }

        $zip->close();

        log_message('info', "Batch completado: {$results['processed']}/{$results['total']} procesados");

        return $results;
    }

    /**
     * Versión con procesamiento paralelo usando curl_multi.
     * (Más rápido para grandes volúmenes)
     *
     * NOTA: En la implementación real del proyecto, el parámetro $concurrency
     * no existe como argumento del método; se lee directamente de $this->concurrency
     * (configurado en app/Config/StirlingPdf.php). Se mantiene como parámetro
     * aquí a modo de ejemplo configurable de forma autónoma.
     */
    public function batchAddImageStampParallel(
        array $pdfPaths,
        string $imagePath,
        array $options = [],
        string $outputZip = '',
        int $concurrency = 5   // En producción: leer de Config\StirlingPdf::$concurrency
    ): array {
        if (empty($outputZip)) {
            $outputZip = WRITEPATH . 'uploads/firmados_' . date('Ymd_His') . '.zip';
        }

        $dir = dirname($outputZip);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $results = [
            'success'   => true,
            'total'     => count($pdfPaths),
            'processed' => 0,
            'errors'    => [],
            'zipPath'   => $outputZip,
        ];

        $zip = new \ZipArchive();
        if ($zip->open($outputZip, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            $results['success'] = false;
            $results['errors'][] = "No se pudo crear el archivo ZIP";
            return $results;
        }

        // Procesar en lotes de $concurrency (para no saturar el servidor)
        $chunks = array_chunk($pdfPaths, $concurrency);

        foreach ($chunks as $chunkIndex => $chunk) {
            $mh      = curl_multi_init();
            $handles = [];

            foreach ($chunk as $i => $pdfPath) {
                $defaults = [
                    'stampType'    => 'image',
                    'pageNumbers'  => 'all',
                    'fontSize'     => 85,
                    'rotation'     => 0,
                    'opacity'      => 1.0,
                    'position'     => 1,
                    'overrideX'    => -1,
                    'overrideY'    => -1,
                    'customMargin' => 'medium',
                    'customColor'  => '#000000',
                    'alphabet'     => 'roman',
                ];
                $params = array_merge($defaults, $options);

                // Usar CURLFile para multipart
                $postFields = [
                    'fileInput'    => new \CURLFile($pdfPath, 'application/pdf', basename($pdfPath)),
                    'stampImage'   => new \CURLFile($imagePath, 'image/jpeg', basename($imagePath)),
                ];
                foreach ($params as $key => $value) {
                    $postFields[$key] = (string) $value;
                }

                $ch = curl_init();
                $curlHeaders = [];
                if (!empty($this->apiKey)) {
                    $curlHeaders[] = 'X-API-KEY: ' . $this->apiKey;
                }

                curl_setopt_array($ch, [
                    CURLOPT_URL            => $this->baseUrl . '/api/v1/misc/add-stamp',
                    CURLOPT_POST           => true,
                    CURLOPT_POSTFIELDS     => $postFields,
                    CURLOPT_HTTPHEADER     => $curlHeaders,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT        => $this->timeout,
                    CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
                ]);

                curl_multi_add_handle($mh, $ch);
                $handles[] = [
                    'handle'   => $ch,
                    'pdfPath'  => $pdfPath,
                    'filename' => basename($pdfPath),
                ];
            }

            // Ejecutar todas las peticiones en paralelo
            $running = null;
            do {
                curl_multi_exec($mh, $running);
                curl_multi_select($mh);
            } while ($running > 0);

            // Recoger resultados
            foreach ($handles as $item) {
                $ch       = $item['handle'];
                $filename = $item['filename'];
                $response = curl_multi_getcontent($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $error    = curl_error($ch);

                if ($error || $httpCode !== 200) {
                    $results['errors'][] = "Error al firmar {$filename}: " . ($error ?: "HTTP {$httpCode}");
                    $results['success'] = false;
                } else {
                    $stampedFilename = pathinfo($filename, PATHINFO_FILENAME) . '_firmado.pdf';
                    $zip->addFromString($stampedFilename, $response);
                    $results['processed']++;
                }

                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }

            curl_multi_close($mh);
        }

        $zip->close();

        return $results;
    }

    // ──────────── Métodos auxiliares ────────────

    private function buildMultipartBody(array $multipart, string $boundary): string
    {
        $body = '';
        foreach ($multipart as $field) {
            $body .= "--{$boundary}\r\n";
            if (isset($field['filename'])) {
                $body .= "Content-Disposition: form-data; name=\"{$field['name']}\"; filename=\"{$field['filename']}\"\r\n";
                $body .= "Content-Type: application/octet-stream\r\n\r\n";
                $body .= (is_resource($field['contents'])) ? stream_get_contents($field['contents']) : $field['contents'];
            } else {
                $body .= "Content-Disposition: form-data; name=\"{$field['name']}\"\r\n\r\n";
                $body .= $field['contents'];
            }
            $body .= "\r\n";
        }
        $body .= "--{$boundary}--\r\n";
        return $body;
    }

    private function formatHeaders(array $headers): array
    {
        $formatted = [];
        foreach ($headers as $key => $value) {
            $formatted[] = "{$key}: {$value}";
        }
        return $formatted;
    }
}
```

### 8.3. Controller en CodeIgniter 4

> **Implementación real del proyecto:** la lógica del controller está en `app/Controllers/Contabilidad.php` (método `procesarFirmaMasiva()`) y delega toda la orquestación a `app/Services/Firma/FirmaService.php`. El ejemplo genérico de abajo es equivalente en comportamiento pero no refleja la estructura real del proyecto.

**`app/Controllers/FirmaController.php`** _(ejemplo de referencia)_

```php
<?php

namespace App\Controllers;

use App\Libraries\StirlingPdfClient;

class FirmaController extends BaseController
{
    /**
     * Vista del formulario de carga
     */
    public function index()
    {
        return view('firma/index');
    }

    /**
     * Procesar la firma masiva
     */
    public function procesarFirmaMasiva()
    {
        // ── 1. Validar los archivos subidos ──
        $rules = [
            'pdfs'  => [
                'label' => 'Archivos PDF',
                'rules' => 'uploaded[pdfs]',
            ],
            'firma' => [
                'label' => 'Imagen de firma',
                'rules' => 'uploaded[firma]|max_size[firma,5120]|ext_in[firma,jpg,jpeg,png]',
            ],
        ];

        if (!$this->validate($rules)) {
            return redirect()->back()->withInput()->with('errors', $this->validator->getErrors());
        }

        // ── 2. Obtener los archivos subidos ──
        $pdfFiles  = $this->request->getFileMultiple('pdfs');
        $firmaFile = $this->request->getFile('firma');

        if (empty($pdfFiles) || !$firmaFile->isValid()) {
            return redirect()->back()->with('error', 'Por favor sube al menos un PDF y la imagen de firma.');
        }

        // ── 3. Mover archivos a directorio temporal ──
        $tempDir = WRITEPATH . 'uploads/temp_firma_' . uniqid() . '/';
        mkdir($tempDir, 0755, true);

        // Guardar imagen de firma
        $firmaPath = $tempDir . 'firma.' . $firmaFile->getExtension();
        $firmaFile->move($tempDir, 'firma.' . $firmaFile->getExtension());

        // Guardar PDFs
        $pdfPaths = [];
        foreach ($pdfFiles as $pdf) {
            if ($pdf->isValid() && !$pdf->hasMoved()) {
                $originalName = $pdf->getClientName();
                $pdf->move($tempDir, $originalName);
                $pdfPaths[] = $tempDir . $originalName;
            }
        }

        if (empty($pdfPaths)) {
            $this->cleanupDir($tempDir);
            return redirect()->back()->with('error', 'No se pudieron procesar los archivos PDF.');
        }

        // ── 4. Configurar parámetros del stamp ──
        $options = [
            'stampType'    => 'image',
            'pageNumbers'  => $this->request->getPost('pageNumbers') ?: 'all',
            'fontSize'     => (float) ($this->request->getPost('fontSize') ?: 85),
            'rotation'     => (float) ($this->request->getPost('rotation') ?: 0),
            'opacity'      => (float) ($this->request->getPost('opacity') ?: 1.0),
            'position'     => (int) ($this->request->getPost('position') ?: 1),
            'overrideX'    => (float) ($this->request->getPost('overrideX') ?: -1),
            'overrideY'    => (float) ($this->request->getPost('overrideY') ?: -1),
            'customMargin' => $this->request->getPost('customMargin') ?: 'medium',
        ];

        // ── 5. Procesar con la librería ──
        $client = new StirlingPdfClient();

        // Usar método paralelo para mayor velocidad
        $result = $client->batchAddImageStampParallel(
            $pdfPaths,
            $firmaPath,
            $options,
            '', // zipPath auto-generado
            5   // 5 peticiones concurrentes
        );

        // ── 6. Limpiar archivos temporales ──
        $this->cleanupDir($tempDir);

        // ── 7. Entregar resultado ──
        if ($result['processed'] === 0) {
            return redirect()->back()->with('error', 'No se pudo firmar ningún archivo. Errores: ' . implode(', ', $result['errors']));
        }

        // Descargar el ZIP
        if (file_exists($result['zipPath'])) {
            return $this->response->download($result['zipPath'], null)
                ->setFileName('documentos_firmados.zip');
        }

        return redirect()->back()->with('error', 'Error al generar el archivo ZIP.');
    }

    /**
     * Endpoint API para uso programático (JSON response)
     * POST /firma/api/batch
     */
    public function apiBatch()
    {
        // Similar a procesarFirmaMasiva pero retorna JSON
        $pdfFiles  = $this->request->getFileMultiple('pdfs');
        $firmaFile = $this->request->getFile('firma');

        if (empty($pdfFiles) || !$firmaFile || !$firmaFile->isValid()) {
            return $this->response->setJSON([
                'success' => false,
                'message' => 'Se requieren archivos PDF y la imagen de firma.',
            ])->setStatusCode(400);
        }

        $tempDir = WRITEPATH . 'uploads/temp_firma_' . uniqid() . '/';
        mkdir($tempDir, 0755, true);

        $firmaPath = $tempDir . 'firma.' . $firmaFile->getExtension();
        $firmaFile->move($tempDir, 'firma.' . $firmaFile->getExtension());

        $pdfPaths = [];
        foreach ($pdfFiles as $pdf) {
            if ($pdf->isValid() && !$pdf->hasMoved()) {
                $name = $pdf->getClientName();
                $pdf->move($tempDir, $name);
                $pdfPaths[] = $tempDir . $name;
            }
        }

        $options = json_decode($this->request->getPost('options') ?? '{}', true) ?: [];

        $client = new StirlingPdfClient();
        $result = $client->batchAddImageStampParallel($pdfPaths, $firmaPath, $options);

        $this->cleanupDir($tempDir);

        if ($result['processed'] > 0 && file_exists($result['zipPath'])) {
            return $this->response->download($result['zipPath'], null)
                ->setFileName('documentos_firmados.zip');
        }

        return $this->response->setJSON($result)->setStatusCode(500);
    }

    private function cleanupDir(string $dir): void
    {
        if (!is_dir($dir)) return;
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($files as $file) {
            $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
        }
        rmdir($dir);
    }
}
```

### 8.4. Rutas

**En `app/Config/Routes.php`** _(rutas reales del proyecto)_:

```php
$routes->get('contabilidad/firma', 'Contabilidad::firma');
$routes->post('contabilidad/firma/procesar', 'Contabilidad::procesarFirmaMasiva');
```

**En `app/Config/Routes.php`** _(ejemplo genérico de referencia)_:

```php
$routes->get('firma', 'FirmaController::index');
$routes->post('firma/procesar', 'FirmaController::procesarFirmaMasiva');
```

### 8.5. Vista del Formulario (Opcional)

**`app/Views/firma/index.php`**

```html
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Firma Masiva de PDFs</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 800px;
        margin: 40px auto;
        padding: 0 20px;
      }
      .form-group {
        margin-bottom: 15px;
      }
      label {
        display: block;
        margin-bottom: 5px;
        font-weight: bold;
      }
      input[type="file"],
      input[type="number"],
      select {
        width: 100%;
        padding: 8px;
        box-sizing: border-box;
      }
      button {
        background: #2563eb;
        color: white;
        padding: 12px 24px;
        border: none;
        cursor: pointer;
        font-size: 16px;
        border-radius: 4px;
      }
      button:hover {
        background: #1d4ed8;
      }
      .row {
        display: flex;
        gap: 15px;
      }
      .row > .form-group {
        flex: 1;
      }
      .alert {
        padding: 12px;
        margin-bottom: 15px;
        border-radius: 4px;
      }
      .alert-error {
        background: #fef2f2;
        color: #dc2626;
        border: 1px solid #fecaca;
      }
      .alert-success {
        background: #f0fdf4;
        color: #16a34a;
        border: 1px solid #bbf7d0;
      }
    </style>
  </head>
  <body>
    <h1>🖊️ Firma Masiva de PDFs</h1>

    <?php if (session()->getFlashdata('error')): ?>
    <div class="alert alert-error"><?= session()->getFlashdata('error') ?></div>
    <?php endif; ?>

    <form action="/firma/procesar" method="POST" enctype="multipart/form-data">
      <?= csrf_field() ?>

      <div class="form-group">
        <label>📄 Archivos PDF (selecciona hasta 50)</label>
        <input type="file" name="pdfs[]" multiple accept=".pdf" required />
      </div>

      <div class="form-group">
        <label>🖊️ Imagen de firma/sello (JPG o PNG)</label>
        <input type="file" name="firma" accept=".jpg,.jpeg,.png" required />
      </div>

      <div class="row">
        <div class="form-group">
          <label>📐 Tamaño (altura en puntos, 28pt ≈ 1cm)</label>
          <input
            type="number"
            name="fontSize"
            value="85"
            step="1"
            min="10"
            max="500"
          />
        </div>
        <div class="form-group">
          <label>📍 Posición</label>
          <select name="position">
            <option value="1">1 - Arriba Izquierda</option>
            <option value="2">2 - Arriba Centro</option>
            <option value="3">3 - Arriba Derecha</option>
            <option value="4">4 - Medio Izquierda</option>
            <option value="5">5 - Centro</option>
            <option value="6">6 - Medio Derecha</option>
            <option value="7" selected>7 - Abajo Izquierda</option>
            <option value="8">8 - Abajo Centro</option>
            <option value="9">9 - Abajo Derecha</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="form-group">
          <label>👁️ Opacidad (0.0 - 1.0)</label>
          <input
            type="number"
            name="opacity"
            value="1.0"
            step="0.1"
            min="0"
            max="1"
          />
        </div>
        <div class="form-group">
          <label>🔄 Rotación (grados)</label>
          <input type="number" name="rotation" value="0" step="1" />
        </div>
      </div>

      <div class="row">
        <div class="form-group">
          <label>↔️ X personalizado (-1 = automático)</label>
          <input type="number" name="overrideX" value="-1" step="1" />
        </div>
        <div class="form-group">
          <label>↕️ Y personalizado (-1 = automático)</label>
          <input type="number" name="overrideY" value="-1" step="1" />
        </div>
      </div>

      <div class="form-group">
        <label>📄 Páginas a firmar</label>
        <input
          type="text"
          name="pageNumbers"
          value="all"
          placeholder="all, 1, 1-5, 1,3,5"
        />
      </div>

      <button type="submit">🚀 Firmar todos los documentos</button>
    </form>
  </body>
</html>
```

---

## 9. Solución de Problemas <a name="troubleshooting"></a>

### Error: "Connection refused"

- Verifica que Stirling-PDF esté corriendo
- El puerto por defecto del backend es `8080` (no `5173` que es el frontend)
- Prueba con: `curl http://localhost:8080/api/v1/misc/add-stamp`

### Error: "413 Request Entity Too Large"

- Stirling-PDF tiene un límite de tamaño predeterminado
- Configura `ENDPOINTS_FILE_MAX_SIZE` en las variables de entorno de Stirling

### Error: "Stamp image file must be provided"

- Verifica que el campo se llame exactamente `stampImage`
- Verifica que `stampType` sea `"image"` (en minúsculas)

### La firma no queda donde quiero

1. Envía UN solo PDF de prueba primero
2. Empieza con `position=1` (abajo-izquierda)
3. Si necesitas más control, usa `overrideX` y `overrideY`
4. Recuerda: el origen `(0,0)` es la **esquina inferior-izquierda**
5. Usa `fontSize` para controlar la **altura** de la imagen

### Ejemplo rápido de prueba con cURL

```bash
curl -X POST "http://localhost:8080/api/v1/misc/add-stamp" \
  -F "fileInput=@mi_documento.pdf" \
  -F "stampImage=@mi_firma.jpg" \
  -F "stampType=image" \
  -F "pageNumbers=all" \
  -F "fontSize=85" \
  -F "rotation=0" \
  -F "opacity=1.0" \
  -F "position=1" \
  -F "overrideX=-1" \
  -F "overrideY=-1" \
  -F "customMargin=medium" \
  -o documento_firmado.pdf
```

### Ejemplo con coordenadas exactas

```bash
curl -X POST "http://localhost:8080/api/v1/misc/add-stamp" \
  -F "fileInput=@mi_documento.pdf" \
  -F "stampImage=@mi_firma.jpg" \
  -F "stampType=image" \
  -F "pageNumbers=1" \
  -F "fontSize=70" \
  -F "rotation=0" \
  -F "opacity=1.0" \
  -F "position=1" \
  -F "overrideX=350" \
  -F "overrideY=50" \
  -F "customMargin=medium" \
  -o documento_firmado.pdf
```

---

> [!NOTE]
> **Resumen final**: Usa el endpoint `/api/v1/misc/add-stamp` con `stampType=image` para cada PDF. La librería `StirlingPdfClient` que se proporciona arriba maneja todo el proceso por lotes, incluyendo procesamiento paralelo y empaquetado en ZIP. Ajusta `fontSize`, `position`, `overrideX`, `overrideY` y `opacity` según tus necesidades.

---

## 10. Separar Páginas en Archivos Individuales + Renombrar <a name="separar-paginas"></a>

### ¿Qué hace esta funcionalidad?

Cuando tienes PDFs de varias páginas (por ejemplo, un archivo con las nóminas de 50 trabajadores, cada página es un trabajador diferente), esta opción:

1. **Firma** cada PDF completo con tu imagen de firma/sello
2. **Separa** cada página del PDF firmado en un archivo individual
3. **Renombra** cada archivo individual según el contenido de esa página (nombre del trabajador, NIF, etc.) o con un texto secuencial

**Resultado**: un ZIP con 50 archivos individuales, cada uno firmado y con nombre propio.

### Endpoint utilizado para la separación

Se usa el endpoint existente de Stirling-PDF:

```
POST /api/v1/general/split-by-size-or-count
Content-Type: multipart/form-data

fileInput    → archivo_firmado.pdf
splitType    → 1          ← separar por cantidad de páginas
splitValue   → 1          ← 1 página por archivo
```

**Respuesta**: ZIP con `archivo_firmado_1.pdf`, `archivo_firmado_2.pdf`, ..., `archivo_firmado_N.pdf`

### Flujo completo desde PHP

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PHP/CodeIgniter 4                                  │
│                                                                      │
│  1. Usuario sube N PDFs + imagen de firma                           │
│     + marca checkbox "Separar páginas"                               │
│     + configura renombrado (opcional)                                │
│                                                                      │
│  2. PHP firma cada PDF → /api/v1/misc/add-stamp                     │
│                                                                      │
│  3. PHP separa cada PDF firmado → /api/v1/general/split-by-size-or-count    │
│     splitType=1, splitValue="1" → 1 página por archivo              │
│     Recibe ZIP con las páginas individuales                          │
│                                                                      │
│  4. PHP descomprime todos los ZIPs de split                          │
│     → Recopila todas las páginas individuales                        │
│                                                                      │
│  5. PHP renombra todas las páginas → /api/v1/misc/rename-pdfs       │
│     Envía TODAS las páginas individuales en una sola petición        │
│     → Recibe ZIP final con archivos renombrados                      │
│                                                                      │
│  6. PHP sirve el ZIP final al usuario                                │
└─────────────────────────────────────────────────────────────────────┘
```

### Parámetros del Split

| Parámetro | Tipo | Valor | Descripción |
|---|---|---|---|
| `fileInput` | `file` (PDF) | El PDF firmado | PDF de entrada a separar |
| `splitType` | `int` | `1` | Separar por cantidad de páginas |
| `splitValue` | `string` | `"1"` | 1 página por archivo |

### Ejemplo cURL: separar un PDF en páginas individuales

```bash
# Separar un PDF firmado en páginas individuales
curl -X POST "http://localhost:8080/api/v1/general/split-by-size-or-count" \
  -F "fileInput=@nominas_firmadas.pdf" \
  -F "splitType=1" \
  -F "splitValue=1" \
  -o paginas_individuales.zip
```

### Ejemplo cURL: flujo completo (firmar → separar → renombrar)

```bash
# Paso 1: Firmar el PDF
curl -X POST "http://localhost:8080/api/v1/misc/add-stamp" \
  -F "fileInput=@nominas_50_trabajadores.pdf" \
  -F "stampImage=@mi_firma.jpg" \
  -F "stampType=image" \
  -F "pageNumbers=all" \
  -F "fontSize=85" \
  -F "rotation=0" \
  -F "opacity=1.0" \
  -F "position=1" \
  -F "overrideX=-1" \
  -F "overrideY=-1" \
  -F "customMargin=medium" \
  -o nominas_firmadas.pdf

# Paso 2: Separar cada página en un archivo individual
curl -X POST "http://localhost:8080/api/v1/general/split-by-size-or-count" \
  -F "fileInput=@nominas_firmadas.pdf" \
  -F "splitType=1" \
  -F "splitValue=1" \
  -o paginas_separadas.zip

# Paso 3: Descomprimir y renombrar por nombre del trabajador
# (primero extraer el ZIP, luego enviar todos los PDFs al endpoint de renombrado)
unzip paginas_separadas.zip -d paginas/

curl -X POST "http://localhost:8080/api/v1/misc/rename-pdfs" \
  -F "fileInput[]=@paginas/nominas_50_trabajadores_1.pdf" \
  -F "fileInput[]=@paginas/nominas_50_trabajadores_2.pdf" \
  -F "fileInput[]=@paginas/nominas_50_trabajadores_3.pdf" \
  -F "renameMode=field_value" \
  -F "labelSearchText=Apellidos y Nombre" \
  -F "labelPosition=below" \
  -o nominas_finales.zip
```

### Implementación en PHP/CodeIgniter 4

Añade el método `splitPdfToPages()` a tu `StirlingPdfClient`:

```php
/**
 * Separar un PDF en archivos individuales (1 página por archivo)
 *
 * @param string $pdfPath       Ruta absoluta al PDF a separar
 * @param string $outputZip     Ruta donde guardar el ZIP resultante
 * @return array                ['success', 'zipPath', 'errors']
 */
public function splitPdfToPages(string $pdfPath, string $outputZip = ''): array
{
    if (empty($outputZip)) {
        $outputZip = WRITEPATH . 'uploads/split_' . date('Ymd_His') . '_' . uniqid() . '.zip';
    }

    $postFields = [
        'fileInput'  => new \CURLFile($pdfPath, 'application/pdf', basename($pdfPath)),
        'splitType'  => '1',     // Separar por cantidad de páginas
        'splitValue' => '1',     // 1 página por archivo
    ];

    $ch = curl_init();
    $headers = [];
    if (!empty($this->apiKey)) {
        $headers[] = 'X-API-KEY: ' . $this->apiKey;
    }

    curl_setopt_array($ch, [
        CURLOPT_URL            => $this->baseUrl . '/api/v1/general/split-by-size-or-count',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postFields,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $this->timeout,
        CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode !== 200) {
        return ['success' => false, 'errors' => [$error ?: "HTTP {$httpCode}"], 'zipPath' => ''];
    }

    file_put_contents($outputZip, $response);

    return ['success' => true, 'errors' => [], 'zipPath' => $outputZip];
}

/**
 * Extraer un ZIP a un directorio y devolver las rutas de los archivos PDF.
 *
 * @param string $zipPath   Ruta del ZIP
 * @param string $destDir   Directorio destino (se crea si no existe)
 * @return array            Rutas absolutas de los PDFs extraídos, ordenados por nombre
 */
public function extractZipToPdfs(string $zipPath, string $destDir): array
{
    if (!is_dir($destDir)) {
        mkdir($destDir, 0755, true);
    }

    $zip = new \ZipArchive();
    if ($zip->open($zipPath) !== true) {
        return [];
    }
    $zip->extractTo($destDir);
    $zip->close();

    $paths = glob($destDir . DIRECTORY_SEPARATOR . '*.pdf');
    sort($paths); // Orden natural por nombre (mantiene orden de páginas)
    return $paths;
}
```

### Controller: flujo con separación de páginas

```php
/**
 * Procesar firma masiva con separación de páginas y renombrado.
 *
 * Flujo: Firmar → Separar páginas → Renombrar → ZIP final
 */
public function procesarFirmaConSeparacion()
{
    // ... (validación y preparación de archivos como en sección 8.3) ...

    $client = new StirlingPdfClient();

    // ── Paso 1: Firmar cada PDF ──
    $resultFirma = $client->batchAddImageStampParallel($pdfPaths, $firmaPath, $stampOptions);

    if ($resultFirma['processed'] === 0) {
        $this->cleanupDir($tempDir);
        return redirect()->back()->with('error', 'No se pudo firmar ningún archivo.');
    }

    // ── Paso 2: Extraer los PDFs firmados del ZIP ──
    $firmadosDir = WRITEPATH . 'uploads/firmados_' . uniqid() . '/';
    $pdfsFirmados = $client->extractZipToPdfs($resultFirma['zipPath'], $firmadosDir);

    // ── Paso 3: Separar cada PDF firmado en páginas individuales ──
    $paginasDir = WRITEPATH . 'uploads/paginas_' . uniqid() . '/';
    mkdir($paginasDir, 0755, true);

    $todasLasPaginas = [];
    $erroresSplit = [];

    foreach ($pdfsFirmados as $pdfFirmado) {
        $resultSplit = $client->splitPdfToPages($pdfFirmado);

        if (!$resultSplit['success']) {
            $erroresSplit[] = "Error al separar " . basename($pdfFirmado) . ": "
                            . implode(', ', $resultSplit['errors']);
            continue;
        }

        // Extraer las páginas individuales del ZIP de split
        $subDir = $paginasDir . pathinfo(basename($pdfFirmado), PATHINFO_FILENAME) . '/';
        $paginas = $client->extractZipToPdfs($resultSplit['zipPath'], $subDir);
        $todasLasPaginas = array_merge($todasLasPaginas, $paginas);

        // Limpiar ZIP temporal del split
        @unlink($resultSplit['zipPath']);
    }

    if (empty($todasLasPaginas)) {
        $this->cleanupDir($tempDir);
        $this->cleanupDir($firmadosDir);
        $this->cleanupDir($paginasDir);
        return redirect()->back()->with('error', 'No se pudo separar ninguna página.');
    }

    // ── Paso 4: Renombrar las páginas individuales ──
    $activarRenombrado = $this->request->getPost('activarRenombrado');

    if ($activarRenombrado) {
        $renameOptions = [
            'renameMode'       => $this->request->getPost('renameMode'),
            'customText'       => $this->request->getPost('customText') ?: '',
            'fieldName'        => $this->request->getPost('fieldName') ?: '',
            'labelSearchText'  => $this->request->getPost('labelSearchText') ?: '',
            'labelPosition'    => $this->request->getPost('labelPosition') ?: 'auto',
            'ocrForExtraction' => $this->request->getPost('ocrForExtraction') ? 'true' : 'false',
        ];
        $resultRename = $client->renamePdfs($todasLasPaginas, $renameOptions);

        if ($resultRename['success']) {
            $zipFinal = $resultRename['zipPath'];
        } else {
            // Si el renombrado falla, empaquetar las páginas sin renombrar
            $zipFinal = $this->empaquetarPdfs($todasLasPaginas);
        }
    } else {
        // Sin renombrado: empaquetar las páginas tal cual
        $zipFinal = $this->empaquetarPdfs($todasLasPaginas);
    }

    // ── Paso 5: Limpiar temporales ──
    $this->cleanupDir($tempDir);
    $this->cleanupDir($firmadosDir);
    $this->cleanupDir($paginasDir);
    @unlink($resultFirma['zipPath']);

    // ── Paso 6: Entregar resultado ──
    if (file_exists($zipFinal)) {
        return $this->response->download($zipFinal, null)
            ->setFileName('documentos_procesados.zip');
    }

    return redirect()->back()->with('error', 'Error al generar el archivo ZIP final.');
}

/**
 * Empaqueta un array de PDFs en un ZIP (cuando no se aplica renombrado).
 */
private function empaquetarPdfs(array $pdfPaths): string
{
    $zipPath = WRITEPATH . 'uploads/resultado_' . date('Ymd_His') . '.zip';
    $zip = new \ZipArchive();
    $zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);

    foreach ($pdfPaths as $path) {
        $zip->addFile($path, basename($path));
    }

    $zip->close();
    return $zipPath;
}
```

### Formulario HTML: checkbox de separación de páginas

```html
<!-- Toggle: Separar páginas en archivos individuales -->
<div class="form-group" style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px; padding:12px; margin-top:10px;">
  <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
    <input type="checkbox" id="activarSeparacion" name="activarSeparacion" value="1" style="width:auto; margin-top:2px;" />
    <span>
      <strong>Separar cada página en un archivo individual</strong><br>
      <small style="color:#1e40af;">
        Activa esta opción si tu PDF contiene varias páginas (ej: 50 nóminas en un solo archivo)
        y quieres que cada página se convierta en un archivo PDF independiente.
        Se combina automáticamente con el renombrado para que cada archivo tenga un nombre único.
      </small>
    </span>
  </label>
</div>

<script>
// Cuando se activa "Separar páginas", mostrar automáticamente las opciones de renombrado
document.getElementById('activarSeparacion').addEventListener('change', function() {
  if (this.checked) {
    // Sugerir activar renombrado cuando se activa separación
    var renombradoCheckbox = document.getElementById('activarRenombrado');
    if (renombradoCheckbox && !renombradoCheckbox.checked) {
      renombradoCheckbox.checked = true;
      renombradoCheckbox.dispatchEvent(new Event('change'));
    }
  }
});
</script>
```

### Ejemplo de uso típico: nóminas

```
Entrada:
  - nominas_febrero.pdf (50 páginas, una por trabajador)
  - firma.jpg (imagen de firma del gerente)

Configuración del panel:
  ✅ Firmar con imagen
  ✅ Separar cada página en archivo individual
  ✅ Renombrar → "Leer campo del PDF"
     Etiqueta: "Apellidos y Nombre"
     Posición: "below" (el nombre está debajo de la etiqueta)

Resultado (ZIP):
  García López, Juan.pdf        ← página 1, firmada
  Martínez Ruiz, Ana.pdf        ← página 2, firmada
  Pérez Fernández, Carlos.pdf   ← página 3, firmada
  ...
  (50 archivos individuales, cada uno firmado y con nombre del trabajador)
```

### Flujo completo combinado: Firmar → Separar → Renombrar → Cifrar

Si además quieres cifrar cada archivo con el NIF del trabajador:

```php
public function procesarFlujoCompleto()
{
    $client = new StirlingPdfClient();

    // 1. Firmar
    $resultFirma = $client->batchAddImageStampParallel($pdfPaths, $firmaPath, $stampOptions);
    $pdfsFirmados = $client->extractZipToPdfs($resultFirma['zipPath'], $firmadosDir);

    // 2. Separar páginas (si está activado)
    if ($this->request->getPost('activarSeparacion')) {
        $todasLasPaginas = [];
        foreach ($pdfsFirmados as $pdf) {
            $resultSplit = $client->splitPdfToPages($pdf);
            if ($resultSplit['success']) {
                $paginas = $client->extractZipToPdfs($resultSplit['zipPath'], $paginasDir . uniqid() . '/');
                $todasLasPaginas = array_merge($todasLasPaginas, $paginas);
                @unlink($resultSplit['zipPath']);
            }
        }
        $archivosActuales = $todasLasPaginas;
    } else {
        $archivosActuales = $pdfsFirmados;
    }

    // 3. Renombrar (si está activado)
    if ($this->request->getPost('activarRenombrado')) {
        $resultRename = $client->renamePdfs($archivosActuales, $renameOptions);
        if ($resultRename['success']) {
            $archivosActuales = $client->extractZipToPdfs($resultRename['zipPath'], $renombradosDir);
        }
    }

    // 4. Cifrar (si está activado)
    if ($this->request->getPost('activarCifrado')) {
        $resultEncrypt = $client->encryptPdfs($archivosActuales, $encryptOptions);
        $zipFinal = $resultEncrypt['zipPath'];
    } else {
        $zipFinal = $this->empaquetarPdfs($archivosActuales);
    }

    return $this->response->download($zipFinal, null)
        ->setFileName('documentos_procesados.zip');
}
```

> [!TIP]
> **Rendimiento**: Si el PDF tiene muchas páginas (50+), el split es muy rápido porque Stirling-PDF lo hace internamente con PDFBox sin re-renderizar. La parte más lenta es el renombrado si se usa OCR. Sin OCR, todo el flujo de 50 páginas debería completarse en menos de 30 segundos.

> [!IMPORTANT]
> **Orden recomendado de las opciones en el panel**: Firma → Separación → Renombrado → Cifrado. El renombrado y cifrado deben ir DESPUÉS de la separación porque necesitan leer el contenido de cada página individual (no del PDF completo).

---

## 11. Renombrar PDFs por Campo <a name="renombrar"></a>

### ¿Qué hace este endpoint?

`POST /api/v1/misc/rename-pdfs` acepta **múltiples PDFs** y devuelve un **ZIP** con cada archivo renombrado según la estrategia elegida:

| Estrategia | Parámetro `renameMode` | Resultado |
|---|---|---|
| Texto fijo + secuencia | `custom_text` | `trabajador_1.pdf`, `trabajador_2.pdf`, … |
| Leer campo del PDF | `field_value` | `pepito_garcia.pdf`, `maria_lopez.pdf`, … |

### Estrategia A: Texto fijo con secuencia (`custom_text`)

Todos los archivos reciben el mismo nombre base con un número incremental. Ideal cuando los documentos son todos del mismo tipo y quieres organizarlos por lote.

```
POST /api/v1/misc/rename-pdfs
Content-Type: multipart/form-data

fileInput[]    → archivo1.pdf
fileInput[]    → archivo2.pdf
renameMode     → custom_text
customText     → nomina_mayo_2025
```

Resultado en el ZIP:
```
nomina_mayo_2025_1.pdf
nomina_mayo_2025_2.pdf
```

### Estrategia B: Leer un campo del PDF (`field_value`)

El endpoint extrae un valor de dentro de cada PDF para usarlo como nombre. Soporta dos métodos de extracción:

#### Método 1: AcroForm field (campo de formulario PDF)

Si el PDF tiene campos de formulario interactivos (AcroForm), se lee el valor directamente por su nombre interno.

```
fileInput[]    → trabajador_001.pdf
renameMode     → field_value
fieldName      → trabajador_nombre
```

El campo `trabajador_nombre` contiene `"Pepito García"` → el archivo se llama `Pepito García.pdf`.

#### Método 2: Búsqueda espacial por etiqueta (para PDFs sin formularios)

Si el PDF no tiene campos AcroForm (es un documento escaneado o generado sin formularios interactivos), el endpoint busca el texto de una etiqueta en el documento y extrae el valor adyacente.

Funciona con etiquetas en cualquier posición relativa al valor:

```
┌──────────────────────────────────┐
│  Apellidos y Nombre              │  ← etiqueta ARRIBA  → labelPosition=below
│  García López, Juan              │  ← valor ABAJO
│                                  │
│  García López, Juan              │  ← valor ARRIBA
│  Apellidos y Nombre              │  ← etiqueta ABAJO  → labelPosition=above
│                                  │
│  N.I.F.:  12345678A              │  ← etiqueta a la IZQUIERDA → labelPosition=right
│                                  │
│  12345678A   N.I.F.              │  ← etiqueta a la DERECHA   → labelPosition=left
└──────────────────────────────────┘
```

> [!IMPORTANT]
> **Semántica de `labelPosition`**: el valor indica **dónde está el valor respecto a la etiqueta**, no dónde está la etiqueta.
> - `below` → el valor está **debajo** de la etiqueta (la etiqueta está arriba)
> - `above` → el valor está **arriba** de la etiqueta (la etiqueta está abajo)
> - `right` → el valor está **a la derecha** de la etiqueta
> - `left` → el valor está **a la izquierda** de la etiqueta

La normalización automática maneja variantes de formato:
- `"N.I.F."` = `"NIF"` = `"N.I.F"` = `"nif"`
- `"Apellidos y Nombre:"` = `"apellidosynombre"`

```
fileInput[]       → trabajador_001.pdf
renameMode        → field_value
labelSearchText   → Apellidos y Nombre
labelPosition     → below         ← el valor está DEBAJO de la etiqueta
```

> [!TIP]
> Si conoces la posición exacta de la etiqueta en tu plantilla de PDF, especifica `labelPosition` en lugar de `auto` para una búsqueda más precisa y rápida.

> [!NOTE]
> **PDFs con múltiples columnas**: en formularios donde hay varias etiquetas en la misma fila (p.ej. `N.I.F. | Apellidos y Nombre | Cargo`), el extractor identifica correctamente la columna de cada etiqueta y devuelve solo el valor de esa columna, sin mezclar datos de otras columnas.

### Colisiones de nombres

Si dos PDFs producen el mismo nombre de salida, el segundo recibe un sufijo automático:

```
García López.pdf      ← primero
García López_2.pdf    ← segundo con mismo nombre
García López_3.pdf    ← tercero, etc.
```

### Parámetros completos

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `fileInput[]` | `file[]` | ✅ | Archivos PDF a renombrar |
| `renameMode` | `string` | ✅ | `custom_text` o `field_value` |
| `customText` | `string` | Si `custom_text` | Texto base para la secuencia |
| `fieldName` | `string` | No | Nombre del campo AcroForm en el PDF |
| `labelSearchText` | `string` | No | Texto de la etiqueta a buscar (si no hay AcroForm) |
| `labelPosition` | `string` | No | `auto` (default), `above`, `below`, `left`, `right` |
| `ocrForExtraction` | `boolean` | No | Activa OCR si el PDF no tiene texto seleccionable. Default: `false`. Ver [Sección 12](#ocr). |

### Ejemplo cURL

```bash
# Con texto fijo
curl -X POST "http://localhost:8080/api/v1/misc/rename-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "renameMode=custom_text" \
  -F "customText=nomina_junio" \
  -o pdfs_renombrados.zip

# Con campo de formulario AcroForm
curl -X POST "http://localhost:8080/api/v1/misc/rename-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "renameMode=field_value" \
  -F "fieldName=trabajador_nombre" \
  -o pdfs_renombrados.zip

# Con búsqueda de etiqueta espacial
curl -X POST "http://localhost:8080/api/v1/misc/rename-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "renameMode=field_value" \
  -F "labelSearchText=Apellidos y Nombre" \
  -F "labelPosition=auto" \
  -o pdfs_renombrados.zip
```

### Implementación en PHP/CodeIgniter 4

Añade el método `renombrarPdfs()` a tu `StirlingPdfClient`:

```php
/**
 * Renombrar múltiples PDFs en Stirling-PDF
 *
 * @param array  $pdfPaths    Rutas absolutas a los PDFs
 * @param array  $options     Configuración (renameMode, customText, fieldName, etc.)
 * @param string $outputZip   Ruta de salida del ZIP
 * @return array              ['success', 'zipPath', 'errors']
 */
public function renamePdfs(array $pdfPaths, array $options = [], string $outputZip = ''): array
{
    if (empty($outputZip)) {
        $outputZip = WRITEPATH . 'uploads/renombrados_' . date('Ymd_His') . '.zip';
    }

    $postFields = [];

    // Agregar archivos PDF
    foreach ($pdfPaths as $i => $path) {
        $postFields["fileInput[{$i}]"] = new \CURLFile($path, 'application/pdf', basename($path));
    }

    // Agregar opciones de renombrado
    $defaults = [
        'renameMode'      => 'field_value',
        'fieldName'       => '',
        'customText'      => '',
        'labelSearchText' => '',
        'labelPosition'   => 'auto',
    ];
    $params = array_merge($defaults, $options);
    foreach ($params as $key => $value) {
        if ($value !== '') {
            $postFields[$key] = (string) $value;
        }
    }

    $ch = curl_init();
    $headers = [];
    if (!empty($this->apiKey)) {
        $headers[] = 'X-API-KEY: ' . $this->apiKey;
    }

    curl_setopt_array($ch, [
        CURLOPT_URL            => $this->baseUrl . '/api/v1/misc/rename-pdfs',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postFields,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $this->timeout,
        CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode !== 200) {
        return ['success' => false, 'errors' => [$error ?: "HTTP {$httpCode}"], 'zipPath' => ''];
    }

    // Guardar el ZIP recibido
    file_put_contents($outputZip, $response);

    return ['success' => true, 'errors' => [], 'zipPath' => $outputZip];
}
```

**Uso desde el controller:**

```php
// Renombrar usando etiqueta "Apellidos y Nombre" — PDF normal con texto seleccionable
$result = $client->renamePdfs($pdfPaths, [
    'renameMode'      => 'field_value',
    'labelSearchText' => 'Apellidos y Nombre',
    'labelPosition'   => 'below',   // el valor está DEBAJO de la etiqueta (etiqueta arriba)
]);

// Renombrar con OCR activado — PDF escaneado sin texto seleccionable
$result = $client->renamePdfs($pdfPaths, [
    'renameMode'       => 'field_value',
    'labelSearchText'  => 'Apellidos y Nombre',
    'labelPosition'    => 'below',
    'ocrForExtraction' => 'true',   // ← el servidor aplicará OCR antes de extraer el nombre
]);

// Renombrar con texto fijo secuencial
$result = $client->renamePdfs($pdfPaths, [
    'renameMode'  => 'custom_text',
    'customText'  => 'nomina_junio_2025',
]);

if ($result['success'] && file_exists($result['zipPath'])) {
    return $this->response->download($result['zipPath'], null)
        ->setFileName('pdfs_renombrados.zip');
}
```

### Formulario HTML para el panel

```html
<!-- Toggle: Activar renombrado -->
<div class="form-group">
  <label>
    <input type="checkbox" id="activarRenombrado" name="activarRenombrado" value="1" />
    Renombrar PDFs automáticamente
  </label>
</div>

<div id="seccionRenombrado" style="display:none; border-left: 3px solid #2563eb; padding-left: 15px; margin-top: 10px;">

  <div class="form-group">
    <label>Estrategia de renombrado</label>
    <select name="renameMode" id="renameMode">
      <option value="custom_text">Texto fijo con secuencia (ej: nomina_1.pdf, nomina_2.pdf)</option>
      <option value="field_value">Leer campo del PDF</option>
    </select>
  </div>

  <!-- Opción: texto fijo -->
  <div id="opcionTextoFijo" class="form-group">
    <label>Texto base del nombre</label>
    <input type="text" name="customText" placeholder="ej: nomina_junio_2025" />
  </div>

  <!-- Opción: campo del PDF -->
  <div id="opcionCampoPdf" style="display:none;">
    <div class="form-group">
      <label>Nombre del campo AcroForm (si el PDF tiene formulario)</label>
      <input type="text" name="fieldName" placeholder="ej: trabajador_nombre" />
    </div>
    <div class="form-group">
      <label>— O — Texto de la etiqueta a buscar en el PDF</label>
      <input type="text" name="labelSearchText" placeholder="ej: Apellidos y Nombre, N.I.F." />
    </div>
    <div class="form-group">
      <label>Posición del valor respecto a la etiqueta</label>
      <select name="labelPosition">
        <option value="auto">Auto (prueba todas las direcciones)</option>
        <option value="below">Valor DEBAJO de la etiqueta (etiqueta arriba)</option>
        <option value="above">Valor ARRIBA de la etiqueta (etiqueta abajo)</option>
        <option value="right">Valor a la DERECHA de la etiqueta</option>
        <option value="left">Valor a la IZQUIERDA de la etiqueta</option>
      </select>
    </div>

    <!-- OCR para PDFs sin texto (nóminas escaneadas) -->
    <div class="form-group" style="background:#fffbeb; border:1px solid #fde68a; border-radius:4px; padding:10px; margin-top:8px;">
      <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
        <input type="checkbox" name="ocrForExtraction" value="1" style="width:auto; margin-top:2px;" />
        <span>
          <strong>Activar OCR para PDFs sin texto seleccionable</strong><br>
          <small style="color:#92400e;">
            Activa esta opción si tus nóminas son imágenes escaneadas y no puedes seleccionar texto con el cursor.
            El servidor aplicará reconocimiento óptico de caracteres (OCR) antes de extraer el nombre/NIF.
            Requiere que Tesseract esté instalado en el servidor.
          </small>
        </span>
      </label>
    </div>
  </div>

</div>

<script>
document.getElementById('activarRenombrado').addEventListener('change', function() {
  document.getElementById('seccionRenombrado').style.display = this.checked ? 'block' : 'none';
});
document.getElementById('renameMode').addEventListener('change', function() {
  document.getElementById('opcionTextoFijo').style.display =
    this.value === 'custom_text' ? 'block' : 'none';
  document.getElementById('opcionCampoPdf').style.display =
    this.value === 'field_value' ? 'block' : 'none';
});
</script>
```

---

## 12. Cifrar PDFs por Campo <a name="cifrar"></a>

### ¿Qué hace este endpoint?

`POST /api/v1/security/encrypt-pdfs` acepta **múltiples PDFs** y devuelve un **ZIP** con cada archivo cifrado con AES-256. Los nombres de archivo se conservan.

| Estrategia | Parámetro `encryptMode` | Resultado |
|---|---|---|
| Contraseña fija | `fixed_password` | Todos los PDFs se cifran con la misma contraseña |
| Contraseña del PDF | `field_value` | Cada PDF se cifra con un valor leído desde su propio contenido |

### Estrategia A: Contraseña fija para todos (`fixed_password`)

```
POST /api/v1/security/encrypt-pdfs
Content-Type: multipart/form-data

fileInput[]    → trabajador_001.pdf
fileInput[]    → trabajador_002.pdf
encryptMode    → fixed_password
password       → MiContraseñaSegura123
keyLength      → 256
```

### Estrategia B: Contraseña leída de cada PDF (`field_value`)

Cada PDF se cifra con un valor extraído de su propio contenido. El caso de uso típico es usar el **NIF del trabajador** como contraseña, de forma que solo él pueda abrirlo.

```
fileInput[]       → pepito_garcia.pdf   (contiene NIF: 12345678A)
fileInput[]       → maria_lopez.pdf     (contiene NIF: 87654321B)
encryptMode       → field_value
fieldName         → trabajador_nif      ← campo AcroForm, O bien:
labelSearchText   → N.I.F.              ← búsqueda espacial por etiqueta
labelPosition     → auto
keyLength         → 256
```

Resultado:
```
pepito_garcia.pdf  → cifrado con contraseña "12345678A"
maria_lopez.pdf    → cifrado con contraseña "87654321B"
```

> [!IMPORTANT]
> La lógica de extracción de campo es idéntica a la del endpoint de renombrado:
> 1. Primero intenta leer `fieldName` como campo AcroForm
> 2. Si no lo encuentra, hace búsqueda espacial con `labelSearchText` + `labelPosition`
> Las etiquetas pueden estar en cualquier posición y se normalizan automáticamente (`"N.I.F."` = `"NIF"`).
>
> **Semántica de `labelPosition`**: indica dónde está **el valor** respecto a la etiqueta.
> - `below` → valor DEBAJO de la etiqueta (p.ej. NIF en la fila siguiente a la etiqueta "N.I.F.")
> - `right` → valor a la DERECHA de la etiqueta (p.ej. `N.I.F.: 12345678A` en la misma línea)
>
> En formularios con múltiples columnas por fila (p.ej. `N.I.F. | Apellidos | Cargo`), el extractor identifica la columna correcta y devuelve solo el valor de esa columna.

### Parámetros completos

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `fileInput[]` | `file[]` | ✅ | Archivos PDF a cifrar |
| `encryptMode` | `string` | ✅ | `fixed_password` o `field_value` |
| `password` | `string` | Si `fixed_password` | Contraseña fija para todos los archivos |
| `fieldName` | `string` | No | Nombre del campo AcroForm cuyo valor es la contraseña |
| `labelSearchText` | `string` | No | Texto de etiqueta a buscar si no hay AcroForm |
| `labelPosition` | `string` | No | `auto` (default), `above`, `below`, `left`, `right` |
| `keyLength` | `int` | No | `128` o `256` (default: `256`) |
| `ocrForExtraction` | `boolean` | No | Activa OCR si el PDF no tiene texto seleccionable. Default: `false`. Ver [Sección 12](#ocr). |

### Ejemplo cURL

```bash
# Contraseña fija para todos
curl -X POST "http://localhost:8080/api/v1/security/encrypt-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "encryptMode=fixed_password" \
  -F "password=MiContraseñaSegura123" \
  -F "keyLength=256" \
  -o pdfs_cifrados.zip

# Contraseña desde campo AcroForm "trabajador_nif"
curl -X POST "http://localhost:8080/api/v1/security/encrypt-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "encryptMode=field_value" \
  -F "fieldName=trabajador_nif" \
  -F "keyLength=256" \
  -o pdfs_cifrados.zip

# Contraseña desde etiqueta "N.I.F." en el texto del PDF
curl -X POST "http://localhost:8080/api/v1/security/encrypt-pdfs" \
  -F "fileInput[]=@trabajador_001.pdf" \
  -F "fileInput[]=@trabajador_002.pdf" \
  -F "encryptMode=field_value" \
  -F "labelSearchText=N.I.F." \
  -F "labelPosition=auto" \
  -F "keyLength=256" \
  -o pdfs_cifrados.zip
```

### Implementación en PHP/CodeIgniter 4

Añade el método `encryptPdfs()` a tu `StirlingPdfClient`:

```php
/**
 * Cifrar múltiples PDFs en Stirling-PDF
 *
 * @param array  $pdfPaths    Rutas absolutas a los PDFs
 * @param array  $options     Configuración (encryptMode, password, fieldName, etc.)
 * @param string $outputZip   Ruta de salida del ZIP
 * @return array              ['success', 'zipPath', 'errors']
 */
public function encryptPdfs(array $pdfPaths, array $options = [], string $outputZip = ''): array
{
    if (empty($outputZip)) {
        $outputZip = WRITEPATH . 'uploads/cifrados_' . date('Ymd_His') . '.zip';
    }

    $postFields = [];

    // Agregar archivos PDF
    foreach ($pdfPaths as $i => $path) {
        $postFields["fileInput[{$i}]"] = new \CURLFile($path, 'application/pdf', basename($path));
    }

    // Agregar opciones de cifrado
    $defaults = [
        'encryptMode'     => 'fixed_password',
        'password'        => '',
        'fieldName'       => '',
        'labelSearchText' => '',
        'labelPosition'   => 'auto',
        'keyLength'       => '256',
    ];
    $params = array_merge($defaults, $options);
    foreach ($params as $key => $value) {
        if ($value !== '') {
            $postFields[$key] = (string) $value;
        }
    }

    $ch = curl_init();
    $headers = [];
    if (!empty($this->apiKey)) {
        $headers[] = 'X-API-KEY: ' . $this->apiKey;
    }

    curl_setopt_array($ch, [
        CURLOPT_URL            => $this->baseUrl . '/api/v1/security/encrypt-pdfs',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postFields,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $this->timeout,
        CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode !== 200) {
        return ['success' => false, 'errors' => [$error ?: "HTTP {$httpCode}"], 'zipPath' => ''];
    }

    file_put_contents($outputZip, $response);

    return ['success' => true, 'errors' => [], 'zipPath' => $outputZip];
}
```

**Uso desde el controller — flujo completo: firmar → renombrar → cifrar:**

```php
public function procesarFirmaMasivaCompleto()
{
    // ... (validación y preparación de archivos como en sección 8.3) ...

    $client = new StirlingPdfClient();

    // ── Paso 1: Firmar los PDFs ──
    $firmadosDir = WRITEPATH . 'uploads/firmados_' . uniqid() . '/';
    mkdir($firmadosDir, 0755, true);

    $resultFirma = $client->batchAddImageStampParallel($pdfPaths, $firmaPath, $stampOptions);

    // Extraer PDFs firmados del ZIP para el siguiente paso
    $pdfsFirmados = $this->extraerZip($resultFirma['zipPath'], $firmadosDir);

    // ── Paso 2: Renombrar (opcional, si el panel lo tiene activado) ──
    if ($this->request->getPost('activarRenombrado')) {
        $renameOptions = [
            'renameMode'       => $this->request->getPost('renameMode'),
            'customText'       => $this->request->getPost('customText') ?: '',
            'fieldName'        => $this->request->getPost('fieldName') ?: '',
            'labelSearchText'  => $this->request->getPost('labelSearchText') ?: '',
            'labelPosition'    => $this->request->getPost('labelPosition') ?: 'auto',
            'ocrForExtraction' => $this->request->getPost('ocrForExtraction') ? 'true' : 'false',
        ];
        $resultRename = $client->renamePdfs($pdfsFirmados, $renameOptions);
        // Reemplazar lista de PDFs con los renombrados para el siguiente paso
        $renombradosDir = WRITEPATH . 'uploads/renombrados_' . uniqid() . '/';
        mkdir($renombradosDir, 0755, true);
        $pdfsFirmados = $this->extraerZip($resultRename['zipPath'], $renombradosDir);
    }

    // ── Paso 3: Cifrar (opcional, si el panel lo tiene activado) ──
    if ($this->request->getPost('activarCifrado')) {
        $encryptOptions = [
            'encryptMode'      => $this->request->getPost('encryptMode'),
            'password'         => $this->request->getPost('passwordFija') ?: '',
            'fieldName'        => $this->request->getPost('campoNif') ?: '',
            'labelSearchText'  => $this->request->getPost('etiquetaNif') ?: '',
            'labelPosition'    => $this->request->getPost('posicionEtiqueta') ?: 'auto',
            'keyLength'        => '256',
            'ocrForExtraction' => $this->request->getPost('ocrForExtractionCifrado') ? 'true' : 'false',
        ];
        $resultEncrypt = $client->encryptPdfs($pdfsFirmados, $encryptOptions);
        $zipFinal = $resultEncrypt['zipPath'];
    } else {
        // Sin cifrado: reempaquetar el estado actual en un ZIP final
        $zipFinal = $resultFirma['zipPath']; // o el de renombrado si se activó
    }

    // ── Entregar resultado ──
    return $this->response->download($zipFinal, null)
        ->setFileName('documentos_procesados.zip');
}

/**
 * Extrae un ZIP y devuelve las rutas absolutas de los archivos extraídos.
 */
private function extraerZip(string $zipPath, string $destDir): array
{
    $zip = new \ZipArchive();
    $zip->open($zipPath);
    $zip->extractTo($destDir);
    $zip->close();

    $paths = [];
    foreach (glob($destDir . '*.pdf') as $path) {
        $paths[] = $path;
    }
    return $paths;
}
```

### Formulario HTML para el panel

```html
<!-- Toggle: Activar cifrado -->
<div class="form-group">
  <label>
    <input type="checkbox" id="activarCifrado" name="activarCifrado" value="1" />
    Cifrar PDFs con contraseña
  </label>
</div>

<div id="seccionCifrado" style="display:none; border-left: 3px solid #dc2626; padding-left: 15px; margin-top: 10px;">

  <div class="form-group">
    <label>Fuente de la contraseña</label>
    <select name="encryptMode" id="encryptMode">
      <option value="fixed_password">Contraseña fija (misma para todos)</option>
      <option value="field_value">Leer del PDF (ej: NIF del trabajador)</option>
    </select>
  </div>

  <!-- Opción: contraseña fija -->
  <div id="opcionPasswordFija" class="form-group">
    <label>Contraseña</label>
    <input type="password" name="passwordFija" placeholder="Contraseña para todos los PDFs" />
  </div>

  <!-- Opción: campo del PDF -->
  <div id="opcionCampoNif" style="display:none;">
    <div class="form-group">
      <label>Nombre del campo AcroForm (si el PDF tiene formulario)</label>
      <input type="text" name="campoNif" placeholder="ej: trabajador_nif" />
    </div>
    <div class="form-group">
      <label>— O — Texto de la etiqueta a buscar (ej: N.I.F., DNI)</label>
      <input type="text" name="etiquetaNif" placeholder="ej: N.I.F." />
    </div>
    <div class="form-group">
      <label>Posición del valor respecto a la etiqueta</label>
      <select name="posicionEtiqueta">
        <option value="auto">Auto (prueba todas las direcciones)</option>
        <option value="below">Valor DEBAJO de la etiqueta (etiqueta arriba)</option>
        <option value="above">Valor ARRIBA de la etiqueta (etiqueta abajo)</option>
        <option value="right">Valor a la DERECHA de la etiqueta</option>
        <option value="left">Valor a la IZQUIERDA de la etiqueta</option>
      </select>
    </div>

    <!-- OCR para PDFs sin texto (nóminas escaneadas) -->
    <div class="form-group" style="background:#fffbeb; border:1px solid #fde68a; border-radius:4px; padding:10px; margin-top:8px;">
      <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
        <input type="checkbox" name="ocrForExtractionCifrado" value="1" style="width:auto; margin-top:2px;" />
        <span>
          <strong>Activar OCR para PDFs sin texto seleccionable</strong><br>
          <small style="color:#92400e;">
            Activa si las nóminas son imágenes escaneadas (no puedes seleccionar texto con el cursor).
            El servidor aplicará OCR antes de buscar el NIF. Requiere Tesseract en el servidor.
          </small>
        </span>
      </label>
    </div>
  </div>

</div>

<script>
document.getElementById('activarCifrado').addEventListener('change', function() {
  document.getElementById('seccionCifrado').style.display = this.checked ? 'block' : 'none';
});
document.getElementById('encryptMode').addEventListener('change', function() {
  document.getElementById('opcionPasswordFija').style.display =
    this.value === 'fixed_password' ? 'block' : 'none';
  document.getElementById('opcionCampoNif').style.display =
    this.value === 'field_value' ? 'block' : 'none';
});
</script>
```

---

> [!NOTE]
> **Resumen de los cuatro endpoints**: La firma masiva (`/api/v1/misc/add-stamp`), la separación de páginas (`/api/v1/general/split-by-size-or-count`), el renombrado (`/api/v1/misc/rename-pdfs`) y el cifrado (`/api/v1/security/encrypt-pdfs`) son **completamente independientes** y pueden usarse en cualquier orden o combinación. El flujo típico es: firmar → separar páginas → renombrar → cifrar, pero cada uno funciona solo perfectamente.

---

## 13. OCR para PDFs sin texto (nóminas escaneadas) <a name="ocr"></a>

### ¿Cuándo es necesario?

Algunos PDFs de nóminas no contienen una capa de texto seleccionable: son imágenes escaneadas convertidas a PDF. Al intentar abrir uno de estos archivos en un lector, **no puedes seleccionar ningún texto con el cursor**.

En estos casos, el extractor de campos de Stirling-PDF no puede leer etiquetas ni valores porque literalmente no hay texto — solo píxeles de imagen. La solución es aplicar **OCR (Reconocimiento Óptico de Caracteres)** antes de intentar la extracción.

### Cómo detectar si tu PDF necesita OCR

```bash
# Intentar extraer texto del PDF con pdftotext (herramienta del sistema)
pdftotext tu_nomina.pdf - | head -20

# Si la salida está vacía o solo tiene espacios → el PDF es imagen, necesita OCR
# Si la salida muestra texto legible → el PDF ya tiene capa de texto, no necesita OCR
```

En el navegador: abre el PDF y prueba `Ctrl+A` para seleccionar todo. Si no selecciona nada (o solo selecciona una zona vacía), necesita OCR.

### Cómo funciona el OCR en Stirling-PDF

Cuando se activa OCR para la extracción de campos:

```
┌────────────────────────────────────────────────────────────┐
│  PDF de entrada                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [IMAGEN ESCANEADA - sin texto seleccionable]        │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬─────────────────────────────────┘
                           │ ¿tiene texto? NO → OCR
                           ▼
┌────────────────────────────────────────────────────────────┐
│  OCRmyPDF / Tesseract                                      │
│  Idiomas: español (spa) + inglés (eng)                     │
│  Genera capa de texto invisible sobre la imagen            │
└──────────────────────────┬─────────────────────────────────┘
                           │ PDF con capa de texto
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Extractor de campos (PdfFieldTextExtractor)               │
│  Busca "Apellidos y Nombre" → extrae el nombre             │
│  Busca "N.I.F." → extrae el DNI                            │
└────────────────────────────────────────────────────────────┘
```

**Comportamiento inteligente**: si el PDF ya tiene texto seleccionable, el OCR se salta automáticamente aunque esté activado. Solo se aplica cuando es necesario.

### Dos formas de activarlo

#### Opción A: Por petición (recomendada para el frontend)

Añade el parámetro `ocrForExtraction=true` en la llamada a la API. Solo se aplica a esa petición concreta:

```bash
# Renombrar PDFs escaneados con OCR
# labelPosition=auto: prueba "right" primero (valor en la misma línea que la etiqueta,
# separado por ":"), luego "below", "left" y "above". Correcto para nóminas donde el
# formato es "Apellidos y Nombre: GARCIA LOPEZ, IVAN" en una sola línea.
curl -X POST "http://localhost:8080/api/v1/misc/rename-pdfs" \
  -F "fileInput[]=@nomina_001.pdf" \
  -F "fileInput[]=@nomina_002.pdf" \
  -F "renameMode=field_value" \
  -F "labelSearchText=Apellidos y Nombre" \
  -F "labelPosition=auto" \
  -F "ocrForExtraction=true" \        ← activa OCR para esta petición
  -o renombrados.zip

# Cifrar PDFs escaneados con OCR (contraseña = NIF extraído por OCR)
curl -X POST "http://localhost:8080/api/v1/security/encrypt-pdfs" \
  -F "fileInput[]=@nomina_001.pdf" \
  -F "fileInput[]=@nomina_002.pdf" \
  -F "encryptMode=field_value" \
  -F "labelSearchText=N.I.F." \
  -F "labelPosition=right" \
  -F "ocrForExtraction=true" \        ← activa OCR para esta petición
  -F "keyLength=256" \
  -o cifrados.zip
```

#### Opción B: Global en el servidor (para entornos donde todas las nóminas son escaneadas)

Edita el archivo `settings.yml` de Stirling-PDF en el servidor:

```yaml
system:
  ocrForFieldExtraction: true  # ← todos los rename-pdfs y encrypt-pdfs aplicarán OCR si es necesario
```

Con esta opción, el frontend no necesita enviar nada extra — el servidor siempre aplicará OCR cuando detecte que el PDF no tiene texto. Útil si **todos** tus documentos son escaneados.

### Parámetro `ocrForExtraction` en los endpoints

Se añade al formulario multipart de `rename-pdfs` y `encrypt-pdfs`:

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `ocrForExtraction` | `boolean` (`true`/`false`) | `false` | Activa OCR antes de extraer campos. Solo aplica si el PDF no tiene texto ya. |

> [!IMPORTANT]
> `ocrForExtraction=true` solo tiene efecto cuando `renameMode=field_value` (renombrado) o `encryptMode=field_value` (cifrado). Con `custom_text` o `fixed_password` no se hace extracción de campos y el parámetro se ignora.

### Implementación PHP — checkbox en el panel

El checkbox en el frontend envía `ocrForExtraction=1` (PHP convierte a `'true'` en el array de opciones):

**Método `renamePdfs()` actualizado** — ya pasa `ocrForExtraction` si está en `$options`:

```php
// En StirlingPdfClient::renamePdfs(), $defaults ya incluye este campo:
$defaults = [
    'renameMode'       => 'field_value',
    'fieldName'        => '',
    'customText'       => '',
    'labelSearchText'  => '',
    'labelPosition'    => 'auto',
    'ocrForExtraction' => 'false',   // ← nuevo
];
```

**Uso desde el controller con el checkbox activado:**

```php
$renameOptions = [
    'renameMode'       => 'field_value',
    'labelSearchText'  => 'Apellidos y Nombre',
    'labelPosition'    => 'below',
    'ocrForExtraction' => $this->request->getPost('ocrForExtraction') ? 'true' : 'false',
];
$result = $client->renamePdfs($pdfPaths, $renameOptions);
```

```php
$encryptOptions = [
    'encryptMode'      => 'field_value',
    'labelSearchText'  => 'N.I.F.',
    'labelPosition'    => 'auto',
    'keyLength'        => '256',
    'ocrForExtraction' => $this->request->getPost('ocrForExtractionCifrado') ? 'true' : 'false',
];
$result = $client->encryptPdfs($pdfPaths, $encryptOptions);
```

### Requisitos del servidor

Para que OCR funcione en Stirling-PDF, el servidor necesita tener instalado:

| Herramienta | Descripción | Prioridad |
|---|---|---|
| **OCRmyPDF** | Motor OCR completo, mejor calidad | Primera opción |
| **Tesseract** + `tesseract-ocr-spa` | Motor alternativo, integrado en el Docker | Fallback automático |

En el Docker de producción personalizado (`stirling-pdf-custom`), Tesseract con español ya está incluido. No hace falta instalar nada adicional.

**Verificar que Tesseract con español está disponible:**

```bash
# Dentro del contenedor Docker
tesseract --list-langs
# Debe aparecer "spa" en la lista

# O desde fuera:
docker exec nombre-contenedor tesseract --list-langs
```

### Rendimiento y consideraciones

| Aspecto | Detalle |
|---|---|
| **Velocidad** | OCR añade ~2-10 segundos por página. Una nómina de 2 páginas: ~4-20s adicionales. |
| **Calidad** | Depende de la resolución del escaneado. 300 DPI o más da buenos resultados. |
| **PDFs con texto** | Se detectan automáticamente y se saltan el OCR — sin coste adicional. |
| **Idioma** | Se intentan español (`spa`) + inglés (`eng`) en ese orden. Si `spa` no está disponible, usa `eng`. |
| **Salida** | El ZIP resultante contiene las nóminas **con capa de texto OCR** añadida, lo que las hace buscables además de renombradas/cifradas. |

> [!TIP]
> Si solo algunas nóminas del lote son escaneadas (mezcla de PDF con texto y PDF imagen), **activa `ocrForExtraction=true` igualmente**. El servidor detecta automáticamente cuáles necesitan OCR y cuáles no, sin procesar innecesariamente los que ya tienen texto.
