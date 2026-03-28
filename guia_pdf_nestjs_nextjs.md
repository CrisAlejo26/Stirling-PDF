# Guia Completa: Suite de Herramientas PDF con NestJS + Next.js

> Implementacion de todas las operaciones PDF (compresion, edicion, separacion, merge, OCR, firmas, conversiones, etc.) usando NestJS como backend y Next.js como frontend.

---

## Tabla de Contenidos

1. [Arquitectura General](#1-arquitectura-general)
2. [Setup del Proyecto](#2-setup-del-proyecto)
3. [Dependencias](#3-dependencias)
4. [Manipulacion de Paginas](#4-manipulacion-de-paginas)
   - 4.1 Reordenar paginas
   - 4.2 Eliminar paginas
   - 4.3 Rotar paginas
   - 4.4 Extraer paginas
   - 4.5 Recortar paginas (crop)
5. [Merge y Split](#5-merge-y-split)
6. [Edicion de Contenido](#6-edicion-de-contenido)
   - 6.1 Agregar texto
   - 6.2 Agregar imagenes
   - 6.3 Agregar marca de agua (watermark)
   - 6.4 Agregar encabezados y pies de pagina
   - 6.5 Agregar numeros de pagina
7. [Formularios PDF](#7-formularios-pdf)
8. [Compresion y Optimizacion](#8-compresion-y-optimizacion)
9. [Seguridad](#9-seguridad)
   - 9.1 Encriptacion y contrasenas
   - 9.2 Firmas digitales
   - 9.3 Redaccion de contenido
   - 9.4 Sanitizacion de metadatos
10. [OCR (Reconocimiento Optico de Caracteres)](#10-ocr)
11. [Extraccion de Datos](#11-extraccion-de-datos)
    - 11.1 Extraer texto
    - 11.2 Extraer imagenes
    - 11.3 Extraer tablas
    - 11.4 Extraer metadatos
12. [Conversiones](#12-conversiones)
    - 12.1 PDF a Imagen (PNG/JPEG/TIFF)
    - 12.2 Imagen a PDF
    - 12.3 PDF a HTML
    - 12.4 HTML a PDF
    - 12.5 Office (DOCX/XLSX/PPTX) a PDF
    - 12.6 PDF a Excel/CSV
    - 12.7 eBook (EPUB/MOBI) a PDF
    - 12.8 Markdown a PDF
    - 12.9 PDF a texto plano
13. [Anotaciones](#13-anotaciones)
14. [Visualizacion en Frontend (PDF Viewer)](#14-visualizacion-en-frontend)
15. [Operaciones en el Cliente (sin servidor)](#15-operaciones-en-el-cliente)
16. [Docker y Despliegue](#16-docker-y-despliegue)
17. [API REST Completa](#17-api-rest-completa)
18. [Manejo de Archivos Grandes](#18-manejo-de-archivos-grandes)
19. [Testing](#19-testing)
20. [Referencia de Librerias](#20-referencia-de-librerias)

---

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────┐
│                   Next.js (Frontend)                │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌────────────────────┐  │
│  │ PDF.js  │  │ pdf-lib │  │ Componentes React  │  │
│  │ Viewer  │  │ Cliente │  │ (Upload, Preview)  │  │
│  └────┬────┘  └────┬────┘  └────────┬───────────┘  │
│       │            │                │               │
│       └────────────┴────────┬───────┘               │
│                             │ API Calls             │
└─────────────────────────────┼───────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│                  NestJS (Backend)                    │
│                                                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ pdf-lib  │  │ Servicios │  │  Controladores   │  │
│  │ node-    │  │ de PDF    │  │  REST API        │  │
│  │ forge    │  │           │  │                  │  │
│  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│       │              │                  │            │
│       └──────────────┴──────┬───────────┘            │
│                             │                        │
│  ┌──────────────────────────┴──────────────────────┐ │
│  │          Binarios del Sistema (child_process)   │ │
│  │  QPDF | Ghostscript | Tesseract | LibreOffice  │ │
│  │  ImageMagick | Poppler | Calibre | FFmpeg       │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Principios de diseno

- **Operaciones ligeras en frontend**: merge, split, reordenar, eliminar paginas se pueden hacer con `pdf-lib` directamente en el navegador sin enviar al servidor.
- **Operaciones pesadas en backend**: OCR, compresion avanzada, conversiones de formato requieren binarios del sistema.
- **Streaming para archivos grandes**: usar streams en lugar de cargar todo en memoria.
- **Procesamiento asincrono**: para operaciones lentas (OCR, conversiones), usar colas con Bull/BullMQ.

---

## 2. Setup del Proyecto

### Estructura de directorios

```
pdf-suite/
├── backend/                    # NestJS
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   │   ├── common/
│   │   │   ├── dto/
│   │   │   │   └── pdf-upload.dto.ts
│   │   │   ├── pipes/
│   │   │   │   └── file-validation.pipe.ts
│   │   │   └── utils/
│   │   │       ├── pdf.utils.ts
│   │   │       └── shell.utils.ts
│   │   ├── modules/
│   │   │   ├── pdf-pages/       # Manipulacion de paginas
│   │   │   ├── pdf-merge/       # Merge y split
│   │   │   ├── pdf-edit/        # Edicion de contenido
│   │   │   ├── pdf-forms/       # Formularios
│   │   │   ├── pdf-compress/    # Compresion
│   │   │   ├── pdf-security/    # Encriptacion, firmas
│   │   │   ├── pdf-ocr/         # OCR
│   │   │   ├── pdf-extract/     # Extraccion de datos
│   │   │   ├── pdf-convert/     # Conversiones
│   │   │   └── pdf-annotate/    # Anotaciones
│   │   └── queue/               # Bull queues para tareas pesadas
│   ├── test/
│   ├── nest-cli.json
│   ├── package.json
│   └── tsconfig.json
├── frontend/                   # Next.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── tools/
│   │   │       ├── merge/page.tsx
│   │   │       ├── split/page.tsx
│   │   │       ├── compress/page.tsx
│   │   │       ├── edit/page.tsx
│   │   │       ├── ocr/page.tsx
│   │   │       ├── convert/page.tsx
│   │   │       ├── security/page.tsx
│   │   │       └── extract/page.tsx
│   │   ├── components/
│   │   │   ├── PdfViewer.tsx
│   │   │   ├── PdfUploader.tsx
│   │   │   ├── PageThumbnails.tsx
│   │   │   └── ToolLayout.tsx
│   │   ├── lib/
│   │   │   ├── pdf-client.ts    # Operaciones pdf-lib en cliente
│   │   │   └── api.ts           # Cliente API
│   │   └── hooks/
│   │       ├── usePdfDocument.ts
│   │       └── usePdfOperation.ts
│   ├── public/
│   │   └── pdf.worker.min.mjs   # Worker de PDF.js
│   ├── package.json
│   └── next.config.js
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
└── package.json                # Workspace root
```

### Inicializacion

```bash
# Crear workspace
mkdir pdf-suite && cd pdf-suite
npm init -y

# Backend NestJS
npx @nestjs/cli new backend --package-manager npm --skip-git
cd backend
npm install @nestjs/platform-express @nestjs/swagger
npm install multer @types/multer
cd ..

# Frontend Next.js
npx create-next-app@latest frontend --typescript --tailwind --app --src-dir
cd frontend
npm install pdfjs-dist @cantoo/pdf-lib
cd ..
```

---

## 3. Dependencias

### Backend (NestJS) - package.json

```json
{
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/swagger": "^8.0.0",
    "@nestjs/bull": "^11.0.0",

    "pdf-lib": "^1.17.1",
    "@cantoo/pdf-lib": "^2.5.3",
    "node-forge": "^1.3.1",
    "pdf-parse": "^1.1.1",
    "sharp": "^0.33.0",
    "tesseract.js": "^5.1.0",
    "tabula-js": "^0.0.4",
    "csv-parse": "^5.5.0",
    "csv-stringify": "^6.5.0",
    "puppeteer": "^23.0.0",
    "marked": "^14.0.0",
    "archiver": "^7.0.0",
    "bull": "^4.16.0",
    "multer": "^1.4.5-lts.1",
    "uuid": "^10.0.0",
    "mime-types": "^2.1.35"
  },
  "devDependencies": {
    "@types/multer": "^1.4.12",
    "@types/node-forge": "^1.3.11",
    "@types/archiver": "^6.0.0"
  }
}
```

### Frontend (Next.js) - package.json

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "pdfjs-dist": "^5.0.0",
    "@cantoo/pdf-lib": "^2.5.3",
    "axios": "^1.7.0",
    "@dnd-kit/core": "^6.3.0",
    "@dnd-kit/sortable": "^10.0.0",
    "react-dropzone": "^14.3.0",
    "signature_pad": "^5.0.0",
    "zustand": "^5.0.0"
  }
}
```

### Binarios del sistema (instalar en servidor/Docker)

```bash
# Ubuntu/Debian
apt-get install -y \
  qpdf \
  ghostscript \
  tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
  libreoffice-writer libreoffice-calc libreoffice-impress \
  imagemagick \
  poppler-utils \
  calibre \
  ffmpeg \
  unpaper
```

---

## 4. Manipulacion de Paginas

### 4.1 Reordenar paginas

**Donde**: Frontend (pdf-lib) o Backend (pdf-lib)

```typescript
// backend/src/modules/pdf-pages/pdf-pages.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';

@Injectable()
export class PdfPagesService {

  /**
   * Reordena las paginas de un PDF segun el orden especificado.
   * @param pdfBuffer - Buffer del PDF original
   * @param newOrder - Array con los indices de pagina en el nuevo orden (0-based)
   *                   Ejemplo: [2, 0, 1] mueve la pagina 3 al inicio
   */
  async reorderPages(pdfBuffer: Buffer, newOrder: number[]): Promise<Buffer> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const newDoc = await PDFDocument.create();

    for (const pageIndex of newOrder) {
      const [copiedPage] = await newDoc.copyPages(srcDoc, [pageIndex]);
      newDoc.addPage(copiedPage);
    }

    const bytes = await newDoc.save();
    return Buffer.from(bytes);
  }
}
```

```typescript
// frontend/src/lib/pdf-client.ts
import { PDFDocument } from '@cantoo/pdf-lib';

/**
 * Reordena paginas directamente en el navegador sin enviar al servidor.
 */
export async function reorderPages(
  file: File,
  newOrder: number[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const newDoc = await PDFDocument.create();

  for (const pageIndex of newOrder) {
    const [copiedPage] = await newDoc.copyPages(srcDoc, [pageIndex]);
    newDoc.addPage(copiedPage);
  }

  return newDoc.save();
}
```

### 4.2 Eliminar paginas

```typescript
// pdf-pages.service.ts (agregar al servicio)

/**
 * Elimina paginas especificas de un PDF.
 * @param pagesToRemove - Indices de paginas a eliminar (0-based)
 */
async removePages(pdfBuffer: Buffer, pagesToRemove: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const newDoc = await PDFDocument.create();
  const totalPages = srcDoc.getPageCount();

  const pagesToKeep = Array.from({ length: totalPages }, (_, i) => i)
    .filter(i => !pagesToRemove.includes(i));

  const copiedPages = await newDoc.copyPages(srcDoc, pagesToKeep);
  copiedPages.forEach(page => newDoc.addPage(page));

  const bytes = await newDoc.save();
  return Buffer.from(bytes);
}
```

### 4.3 Rotar paginas

```typescript
/**
 * Rota paginas especificas.
 * @param rotations - Map de indice de pagina -> grados de rotacion (90, 180, 270)
 */
async rotatePages(
  pdfBuffer: Buffer,
  rotations: Record<number, number>
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);

  for (const [pageIndexStr, degrees] of Object.entries(rotations)) {
    const pageIndex = parseInt(pageIndexStr);
    const page = doc.getPage(pageIndex);
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees(currentRotation + degrees));
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
```

> **Nota**: `degrees()` es una funcion de pdf-lib. Importar con:
> `import { degrees } from '@cantoo/pdf-lib';`

### 4.4 Extraer paginas

```typescript
/**
 * Extrae un rango de paginas y crea un nuevo PDF.
 * @param pageRanges - Array de rangos, ej: [{start: 0, end: 4}, {start: 7, end: 9}]
 */
async extractPages(
  pdfBuffer: Buffer,
  pageRanges: { start: number; end: number }[]
): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const newDoc = await PDFDocument.create();

  const indices: number[] = [];
  for (const range of pageRanges) {
    for (let i = range.start; i <= range.end; i++) {
      indices.push(i);
    }
  }

  const copiedPages = await newDoc.copyPages(srcDoc, indices);
  copiedPages.forEach(page => newDoc.addPage(page));

  const bytes = await newDoc.save();
  return Buffer.from(bytes);
}
```

### 4.5 Recortar paginas (Crop)

```typescript
/**
 * Recorta (crop) las paginas de un PDF a un area especifica.
 * Las coordenadas usan el sistema PDF: origen en esquina inferior izquierda.
 */
async cropPages(
  pdfBuffer: Buffer,
  cropBox: { x: number; y: number; width: number; height: number },
  pageIndices?: number[]
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const pages = pageIndices
    ? pageIndices.map(i => doc.getPage(i))
    : doc.getPages();

  for (const page of pages) {
    page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
```

### Controlador de paginas

```typescript
// backend/src/modules/pdf-pages/pdf-pages.controller.ts
import {
  Controller, Post, Body, UploadedFile,
  UseInterceptors, Res, StreamableFile
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfPagesService } from './pdf-pages.service';

@ApiTags('PDF Pages')
@Controller('api/v1/pdf/pages')
export class PdfPagesController {
  constructor(private readonly pdfPagesService: PdfPagesService) {}

  @Post('reorder')
  @ApiOperation({ summary: 'Reordenar paginas de un PDF' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async reorder(
    @UploadedFile() file: Express.Multer.File,
    @Body('order') order: string, // JSON array: "[2,0,1,3]"
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const newOrder = JSON.parse(order);
    const result = await this.pdfPagesService.reorderPages(file.buffer, newOrder);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reordered-${file.originalname}"`,
    });
    return new StreamableFile(result);
  }

  @Post('remove')
  @ApiOperation({ summary: 'Eliminar paginas de un PDF' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async remove(
    @UploadedFile() file: Express.Multer.File,
    @Body('pages') pages: string, // JSON array: "[1,3,5]"
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pagesToRemove = JSON.parse(pages);
    const result = await this.pdfPagesService.removePages(file.buffer, pagesToRemove);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="trimmed-${file.originalname}"`,
    });
    return new StreamableFile(result);
  }

  @Post('rotate')
  @ApiOperation({ summary: 'Rotar paginas de un PDF' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async rotate(
    @UploadedFile() file: Express.Multer.File,
    @Body('rotations') rotations: string, // JSON: {"0": 90, "2": 180}
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rotationMap = JSON.parse(rotations);
    const result = await this.pdfPagesService.rotatePages(file.buffer, rotationMap);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rotated-${file.originalname}"`,
    });
    return new StreamableFile(result);
  }

  @Post('extract')
  @ApiOperation({ summary: 'Extraer paginas de un PDF' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async extract(
    @UploadedFile() file: Express.Multer.File,
    @Body('ranges') ranges: string, // JSON: [{"start":0,"end":2}]
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pageRanges = JSON.parse(ranges);
    const result = await this.pdfPagesService.extractPages(file.buffer, pageRanges);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="extracted-${file.originalname}"`,
    });
    return new StreamableFile(result);
  }

  @Post('crop')
  @ApiOperation({ summary: 'Recortar paginas de un PDF' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async crop(
    @UploadedFile() file: Express.Multer.File,
    @Body('cropBox') cropBox: string, // JSON: {"x":50,"y":50,"width":400,"height":600}
    @Body('pages') pages?: string,    // JSON: [0,1,2] (opcional)
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const box = JSON.parse(cropBox);
    const pageIndices = pages ? JSON.parse(pages) : undefined;
    const result = await this.pdfPagesService.cropPages(file.buffer, box, pageIndices);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropped-${file.originalname}"`,
    });
    return new StreamableFile(result);
  }
}
```

---

## 5. Merge y Split

### Merge (unir multiples PDFs)

```typescript
// backend/src/modules/pdf-merge/pdf-merge.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';

@Injectable()
export class PdfMergeService {

  /**
   * Une multiples PDFs en uno solo, en el orden proporcionado.
   */
  async mergePdfs(pdfBuffers: Buffer[]): Promise<Buffer> {
    const mergedDoc = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
      const srcDoc = await PDFDocument.load(buffer);
      const copiedPages = await mergedDoc.copyPages(
        srcDoc,
        srcDoc.getPageIndices()
      );
      copiedPages.forEach(page => mergedDoc.addPage(page));
    }

    const bytes = await mergedDoc.save();
    return Buffer.from(bytes);
  }

  /**
   * Intercala paginas de dos PDFs alternadamente.
   * Util para escaneos de doble cara.
   */
  async interleavePdfs(
    pdfBufferA: Buffer,
    pdfBufferB: Buffer,
    reverseB: boolean = false
  ): Promise<Buffer> {
    const docA = await PDFDocument.load(pdfBufferA);
    const docB = await PDFDocument.load(pdfBufferB);
    const merged = await PDFDocument.create();

    const pagesA = docA.getPageIndices();
    let pagesB = docB.getPageIndices();
    if (reverseB) pagesB = pagesB.reverse();

    const maxLen = Math.max(pagesA.length, pagesB.length);

    for (let i = 0; i < maxLen; i++) {
      if (i < pagesA.length) {
        const [page] = await merged.copyPages(docA, [pagesA[i]]);
        merged.addPage(page);
      }
      if (i < pagesB.length) {
        const [page] = await merged.copyPages(docB, [pagesB[i]]);
        merged.addPage(page);
      }
    }

    const bytes = await merged.save();
    return Buffer.from(bytes);
  }
}
```

### Split (dividir PDF)

```typescript
// backend/src/modules/pdf-merge/pdf-split.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';

@Injectable()
export class PdfSplitService {

  /**
   * Divide un PDF en paginas individuales.
   * Retorna un array de buffers, uno por pagina.
   */
  async splitToIndividualPages(pdfBuffer: Buffer): Promise<Buffer[]> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const result: Buffer[] = [];

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const newDoc = await PDFDocument.create();
      const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(copiedPage);
      result.push(Buffer.from(await newDoc.save()));
    }

    return result;
  }

  /**
   * Divide un PDF por rangos de paginas.
   * @param ranges - Ej: [{start:0, end:2}, {start:3, end:5}]
   */
  async splitByRanges(
    pdfBuffer: Buffer,
    ranges: { start: number; end: number }[]
  ): Promise<Buffer[]> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const result: Buffer[] = [];

    for (const range of ranges) {
      const newDoc = await PDFDocument.create();
      const indices = [];
      for (let i = range.start; i <= range.end; i++) {
        indices.push(i);
      }
      const copiedPages = await newDoc.copyPages(srcDoc, indices);
      copiedPages.forEach(page => newDoc.addPage(page));
      result.push(Buffer.from(await newDoc.save()));
    }

    return result;
  }

  /**
   * Divide un PDF cada N paginas.
   */
  async splitEveryN(pdfBuffer: Buffer, n: number): Promise<Buffer[]> {
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();
    const ranges: { start: number; end: number }[] = [];

    for (let i = 0; i < totalPages; i += n) {
      ranges.push({
        start: i,
        end: Math.min(i + n - 1, totalPages - 1)
      });
    }

    return this.splitByRanges(pdfBuffer, ranges);
  }

  /**
   * Empaqueta multiples PDFs en un ZIP para descarga.
   */
  async packAsZip(
    pdfBuffers: Buffer[],
    baseName: string
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      const passthrough = new PassThrough();

      passthrough.on('data', chunk => chunks.push(chunk));
      passthrough.on('end', () => resolve(Buffer.concat(chunks)));
      passthrough.on('error', reject);

      archive.pipe(passthrough);

      pdfBuffers.forEach((buf, i) => {
        archive.append(buf, {
          name: `${baseName}_${String(i + 1).padStart(3, '0')}.pdf`
        });
      });

      archive.finalize();
    });
  }
}
```

### Controlador de Merge/Split

```typescript
// backend/src/modules/pdf-merge/pdf-merge.controller.ts
import {
  Controller, Post, Body, UploadedFiles,
  UseInterceptors, Res, StreamableFile
} from '@nestjs/common';
import { FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfMergeService } from './pdf-merge.service';
import { PdfSplitService } from './pdf-split.service';

@ApiTags('PDF Merge & Split')
@Controller('api/v1/pdf')
export class PdfMergeController {
  constructor(
    private readonly mergeService: PdfMergeService,
    private readonly splitService: PdfSplitService,
  ) {}

  @Post('merge')
  @ApiOperation({ summary: 'Unir multiples PDFs en uno' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 50)) // maximo 50 archivos
  async merge(
    @UploadedFiles() files: Express.Multer.File[],
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffers = files.map(f => f.buffer);
    const result = await this.mergeService.mergePdfs(buffers);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="merged.pdf"',
    });
    return new StreamableFile(result);
  }

  @Post('split')
  @ApiOperation({ summary: 'Dividir un PDF en partes' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async split(
    @UploadedFile() file: Express.Multer.File,
    @Body('mode') mode: 'individual' | 'ranges' | 'everyN',
    @Body('ranges') ranges?: string,  // JSON para modo ranges
    @Body('n') n?: string,            // numero para modo everyN
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    let parts: Buffer[];

    switch (mode) {
      case 'individual':
        parts = await this.splitService.splitToIndividualPages(file.buffer);
        break;
      case 'ranges':
        parts = await this.splitService.splitByRanges(
          file.buffer, JSON.parse(ranges)
        );
        break;
      case 'everyN':
        parts = await this.splitService.splitEveryN(
          file.buffer, parseInt(n)
        );
        break;
    }

    const baseName = file.originalname.replace('.pdf', '');
    const zip = await this.splitService.packAsZip(parts, baseName);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${baseName}_split.zip"`,
    });
    return new StreamableFile(zip);
  }
}
```

---

## 6. Edicion de Contenido

### 6.1 Agregar texto

```typescript
// backend/src/modules/pdf-edit/pdf-edit.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, PageSizes } from '@cantoo/pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs/promises';

@Injectable()
export class PdfEditService {

  /**
   * Agrega texto a una pagina especifica del PDF.
   */
  async addText(
    pdfBuffer: Buffer,
    options: {
      pageIndex: number;
      text: string;
      x: number;
      y: number;
      fontSize?: number;
      fontFamily?: 'Helvetica' | 'TimesRoman' | 'Courier';
      color?: { r: number; g: number; b: number };
      opacity?: number;
      rotation?: number;
      maxWidth?: number;
    }
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const page = doc.getPage(options.pageIndex);

    // Seleccionar fuente estandar
    const fontMap = {
      Helvetica: StandardFonts.Helvetica,
      TimesRoman: StandardFonts.TimesRoman,
      Courier: StandardFonts.Courier,
    };
    const font = await doc.embedFont(
      fontMap[options.fontFamily || 'Helvetica']
    );

    const color = options.color
      ? rgb(options.color.r / 255, options.color.g / 255, options.color.b / 255)
      : rgb(0, 0, 0);

    page.drawText(options.text, {
      x: options.x,
      y: options.y,
      size: options.fontSize || 12,
      font,
      color,
      opacity: options.opacity ?? 1,
      rotate: options.rotation ? degrees(options.rotation) : undefined,
      maxWidth: options.maxWidth,
      lineHeight: (options.fontSize || 12) * 1.2,
    });

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega texto con fuente personalizada (TTF/OTF).
   */
  async addTextCustomFont(
    pdfBuffer: Buffer,
    fontPath: string,
    options: {
      pageIndex: number;
      text: string;
      x: number;
      y: number;
      fontSize: number;
    }
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    doc.registerFontkit(fontkit);

    const fontBytes = await fs.readFile(fontPath);
    const customFont = await doc.embedFont(fontBytes);

    const page = doc.getPage(options.pageIndex);
    page.drawText(options.text, {
      x: options.x,
      y: options.y,
      size: options.fontSize,
      font: customFont,
    });

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega multiples bloques de texto a un PDF.
   * Ideal para plantillas o formularios custom.
   */
  async addMultipleTextBlocks(
    pdfBuffer: Buffer,
    blocks: Array<{
      pageIndex: number;
      text: string;
      x: number;
      y: number;
      fontSize?: number;
      bold?: boolean;
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const regularFont = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const block of blocks) {
      const page = doc.getPage(block.pageIndex);
      page.drawText(block.text, {
        x: block.x,
        y: block.y,
        size: block.fontSize || 12,
        font: block.bold ? boldFont : regularFont,
      });
    }

    return Buffer.from(await doc.save());
  }
}
```

### 6.2 Agregar imagenes

```typescript
// Agregar al PdfEditService

/**
 * Agrega una imagen (PNG/JPEG) a una pagina del PDF.
 */
async addImage(
  pdfBuffer: Buffer,
  imageBuffer: Buffer,
  imageType: 'png' | 'jpeg',
  options: {
    pageIndex: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
    opacity?: number;
    rotation?: number;
  }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const page = doc.getPage(options.pageIndex);

  const image = imageType === 'png'
    ? await doc.embedPng(imageBuffer)
    : await doc.embedJpg(imageBuffer);

  // Si no se especifica tamano, usar tamano original
  const width = options.width || image.width;
  const height = options.height || image.height;

  page.drawImage(image, {
    x: options.x,
    y: options.y,
    width,
    height,
    opacity: options.opacity ?? 1,
    rotate: options.rotation ? degrees(options.rotation) : undefined,
  });

  return Buffer.from(await doc.save());
}

/**
 * Agrega una imagen como pagina completa (ej: portada).
 */
async addImageAsPage(
  pdfBuffer: Buffer,
  imageBuffer: Buffer,
  imageType: 'png' | 'jpeg',
  position: 'start' | 'end' | number
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);

  const image = imageType === 'png'
    ? await doc.embedPng(imageBuffer)
    : await doc.embedJpg(imageBuffer);

  const page = doc.insertPage(
    position === 'start' ? 0
      : position === 'end' ? doc.getPageCount()
      : position,
    [image.width, image.height]
  );

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  return Buffer.from(await doc.save());
}
```

### 6.3 Marca de agua (Watermark)

```typescript
// Agregar al PdfEditService

/**
 * Agrega marca de agua de texto a todas las paginas.
 */
async addTextWatermark(
  pdfBuffer: Buffer,
  options: {
    text: string;
    fontSize?: number;
    color?: { r: number; g: number; b: number };
    opacity?: number;
    rotation?: number; // grados, tipicamente -45
  }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = options.fontSize || 60;
  const rotation = options.rotation ?? -45;
  const opacity = options.opacity ?? 0.15;
  const color = options.color
    ? rgb(options.color.r / 255, options.color.g / 255, options.color.b / 255)
    : rgb(0.5, 0.5, 0.5);

  const textWidth = font.widthOfTextAtSize(options.text, fontSize);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // Centrar el texto en la pagina
    const x = (width - textWidth * Math.cos(Math.abs(rotation) * Math.PI / 180)) / 2;
    const y = height / 2;

    page.drawText(options.text, {
      x, y,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: degrees(rotation),
    });
  }

  return Buffer.from(await doc.save());
}

/**
 * Agrega marca de agua con imagen a todas las paginas.
 */
async addImageWatermark(
  pdfBuffer: Buffer,
  imageBuffer: Buffer,
  imageType: 'png' | 'jpeg',
  options: {
    opacity?: number;
    scale?: number; // 0.0 - 1.0 respecto al tamano de pagina
    position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const image = imageType === 'png'
    ? await doc.embedPng(imageBuffer)
    : await doc.embedJpg(imageBuffer);

  const scale = options.scale ?? 0.5;
  const opacity = options.opacity ?? 0.2;
  const position = options.position ?? 'center';

  for (const page of doc.getPages()) {
    const { width: pageW, height: pageH } = page.getSize();
    const imgW = pageW * scale;
    const imgH = (image.height / image.width) * imgW;

    let x: number, y: number;
    switch (position) {
      case 'center':
        x = (pageW - imgW) / 2;
        y = (pageH - imgH) / 2;
        break;
      case 'top-left':
        x = 20; y = pageH - imgH - 20;
        break;
      case 'top-right':
        x = pageW - imgW - 20; y = pageH - imgH - 20;
        break;
      case 'bottom-left':
        x = 20; y = 20;
        break;
      case 'bottom-right':
        x = pageW - imgW - 20; y = 20;
        break;
    }

    page.drawImage(image, { x, y, width: imgW, height: imgH, opacity });
  }

  return Buffer.from(await doc.save());
}
```

### 6.4 Encabezados y pies de pagina

```typescript
/**
 * Agrega encabezado y/o pie de pagina a todas las paginas.
 */
async addHeaderFooter(
  pdfBuffer: Buffer,
  options: {
    header?: {
      text: string;
      fontSize?: number;
      align?: 'left' | 'center' | 'right';
    };
    footer?: {
      text: string;
      fontSize?: number;
      align?: 'left' | 'center' | 'right';
    };
    margin?: number;
    skipFirstPage?: boolean;
  }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const margin = options.margin ?? 40;
  const pages = doc.getPages();

  for (let i = 0; i < pages.length; i++) {
    if (options.skipFirstPage && i === 0) continue;
    const page = pages[i];
    const { width, height } = page.getSize();

    if (options.header) {
      const fontSize = options.header.fontSize || 10;
      const text = options.header.text
        .replace('{page}', String(i + 1))
        .replace('{total}', String(pages.length))
        .replace('{date}', new Date().toLocaleDateString());

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x: number;
      switch (options.header.align) {
        case 'left': x = margin; break;
        case 'right': x = width - textWidth - margin; break;
        default: x = (width - textWidth) / 2;
      }

      page.drawText(text, {
        x, y: height - margin,
        size: fontSize, font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    if (options.footer) {
      const fontSize = options.footer.fontSize || 10;
      const text = options.footer.text
        .replace('{page}', String(i + 1))
        .replace('{total}', String(pages.length))
        .replace('{date}', new Date().toLocaleDateString());

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x: number;
      switch (options.footer.align) {
        case 'left': x = margin; break;
        case 'right': x = width - textWidth - margin; break;
        default: x = (width - textWidth) / 2;
      }

      page.drawText(text, {
        x, y: margin - fontSize,
        size: fontSize, font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }

  return Buffer.from(await doc.save());
}
```

### 6.5 Numeros de pagina

```typescript
/**
 * Agrega numeracion de paginas.
 * Wrapper simplificado de addHeaderFooter.
 */
async addPageNumbers(
  pdfBuffer: Buffer,
  options: {
    format?: 'simple' | 'withTotal' | 'roman';
    position?: 'bottom-center' | 'bottom-right' | 'bottom-left'
              | 'top-center' | 'top-right' | 'top-left';
    startFrom?: number;
    skipPages?: number[]; // indices de paginas a saltar
    fontSize?: number;
  }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize || 10;
  const startFrom = options.startFrom ?? 1;
  const position = options.position ?? 'bottom-center';
  const pages = doc.getPages();

  const toRoman = (num: number): string => {
    const romanNumerals: [number, string][] = [
      [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],
      [100,'C'],[90,'XC'],[50,'L'],[40,'XL'],
      [10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
    ];
    let result = '';
    for (const [value, numeral] of romanNumerals) {
      while (num >= value) { result += numeral; num -= value; }
    }
    return result;
  };

  for (let i = 0; i < pages.length; i++) {
    if (options.skipPages?.includes(i)) continue;

    const pageNum = i + startFrom;
    let text: string;
    switch (options.format) {
      case 'withTotal':
        text = `${pageNum} / ${pages.length + startFrom - 1}`;
        break;
      case 'roman':
        text = toRoman(pageNum).toLowerCase();
        break;
      default:
        text = String(pageNum);
    }

    const page = pages[i];
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const margin = 40;

    let x: number, y: number;
    const isTop = position.startsWith('top');
    y = isTop ? height - margin : margin - fontSize;

    if (position.endsWith('center')) x = (width - textWidth) / 2;
    else if (position.endsWith('right')) x = width - textWidth - margin;
    else x = margin;

    page.drawText(text, {
      x, y, size: fontSize, font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return Buffer.from(await doc.save());
}
```

---

## 7. Formularios PDF

```typescript
// backend/src/modules/pdf-forms/pdf-forms.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown,
         PDFRadioGroup, PDFName } from '@cantoo/pdf-lib';

@Injectable()
export class PdfFormsService {

  /**
   * Lista todos los campos de formulario de un PDF.
   */
  async getFormFields(pdfBuffer: Buffer): Promise<Array<{
    name: string;
    type: string;
    value: string | boolean | string[];
    options?: string[]; // para dropdowns
  }>> {
    const doc = await PDFDocument.load(pdfBuffer);
    const form = doc.getForm();
    const fields = form.getFields();

    return fields.map(field => {
      const name = field.getName();
      const type = field.constructor.name;

      let value: any;
      let options: string[] | undefined;

      if (field instanceof PDFTextField) {
        value = field.getText() || '';
      } else if (field instanceof PDFCheckBox) {
        value = field.isChecked();
      } else if (field instanceof PDFDropdown) {
        value = field.getSelected();
        options = field.getOptions();
      } else if (field instanceof PDFRadioGroup) {
        value = field.getSelected();
        options = field.getOptions();
      } else {
        value = '';
      }

      return { name, type, value, options };
    });
  }

  /**
   * Rellena los campos de formulario de un PDF.
   * @param fieldValues - Map de nombre_campo -> valor
   */
  async fillForm(
    pdfBuffer: Buffer,
    fieldValues: Record<string, string | boolean>,
    flatten: boolean = false
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const form = doc.getForm();

    for (const [fieldName, value] of Object.entries(fieldValues)) {
      try {
        if (typeof value === 'boolean') {
          const checkbox = form.getCheckBox(fieldName);
          value ? checkbox.check() : checkbox.uncheck();
        } else {
          // Intentar como text field primero, luego dropdown
          try {
            const textField = form.getTextField(fieldName);
            textField.setText(value);
          } catch {
            try {
              const dropdown = form.getDropdown(fieldName);
              dropdown.select(value);
            } catch {
              const radioGroup = form.getRadioGroup(fieldName);
              radioGroup.select(value);
            }
          }
        }
      } catch (e) {
        console.warn(`Campo no encontrado o tipo incompatible: ${fieldName}`, e.message);
      }
    }

    // Aplanar formulario (convierte campos en texto estatico)
    if (flatten) {
      form.flatten();
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Crea un formulario PDF desde cero.
   */
  async createForm(
    fields: Array<{
      name: string;
      type: 'text' | 'checkbox' | 'dropdown' | 'multiline';
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      options?: string[];   // para dropdown
      defaultValue?: string;
      required?: boolean;
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();

    // Agregar paginas segun sea necesario
    while (doc.getPageCount() < Math.max(...fields.map(f => f.page + 1))) {
      doc.addPage();
    }

    for (const field of fields) {
      const targetPage = doc.getPage(field.page);

      switch (field.type) {
        case 'text': {
          const textField = form.createTextField(field.name);
          textField.addToPage(targetPage, {
            x: field.x, y: field.y,
            width: field.width, height: field.height,
          });
          if (field.defaultValue) textField.setText(field.defaultValue);
          break;
        }
        case 'multiline': {
          const multilineField = form.createTextField(field.name);
          multilineField.enableMultiline();
          multilineField.addToPage(targetPage, {
            x: field.x, y: field.y,
            width: field.width, height: field.height,
          });
          break;
        }
        case 'checkbox': {
          const checkbox = form.createCheckBox(field.name);
          checkbox.addToPage(targetPage, {
            x: field.x, y: field.y,
            width: field.width, height: field.height,
          });
          break;
        }
        case 'dropdown': {
          const dropdown = form.createDropdown(field.name);
          if (field.options) dropdown.addOptions(field.options);
          dropdown.addToPage(targetPage, {
            x: field.x, y: field.y,
            width: field.width, height: field.height,
          });
          if (field.defaultValue) dropdown.select(field.defaultValue);
          break;
        }
      }
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Aplana un formulario PDF (convierte campos interactivos en contenido estatico).
   */
  async flattenForm(pdfBuffer: Buffer): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const form = doc.getForm();
    form.flatten();
    return Buffer.from(await doc.save());
  }
}
```

---

## 8. Compresion y Optimizacion

```typescript
// backend/src/modules/pdf-compress/pdf-compress.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

const execAsync = promisify(exec);

@Injectable()
export class PdfCompressService {

  /**
   * Compresion basica con pdf-lib: elimina metadatos innecesarios y reescribe.
   */
  async compressBasic(pdfBuffer: Buffer): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer, {
      updateMetadata: false,
    });
    // Reescribir el PDF elimina datos huerfanos
    return Buffer.from(await doc.save());
  }

  /**
   * Compresion con Ghostscript - multiples niveles de calidad.
   *
   * Niveles:
   * - 'screen': 72 dpi, maxima compresion, baja calidad (para pantalla)
   * - 'ebook': 150 dpi, buena compresion, calidad aceptable
   * - 'printer': 300 dpi, compresion moderada, alta calidad
   * - 'prepress': minima compresion, maxima calidad (para imprenta)
   */
  async compressGhostscript(
    pdfBuffer: Buffer,
    level: 'screen' | 'ebook' | 'printer' | 'prepress' = 'ebook'
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_compressed.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const cmd = [
        'gs',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        `-dPDFSETTINGS=/${level}`,
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        `-sOutputFile=${outputPath}`,
        inputPath,
      ].join(' ');

      await execAsync(cmd, { timeout: 120000 });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Compresion con QPDF: linearizacion y optimizacion de streams.
   */
  async compressQpdf(
    pdfBuffer: Buffer,
    options: {
      linearize?: boolean;       // Optimizar para web (Fast Web View)
      objectStreams?: boolean;    // Comprimir object streams
      compressStreams?: boolean;  // Comprimir content streams
      recompressFlate?: boolean; // Recomprimir con mejor nivel
    } = {}
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_qpdf.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const args = ['qpdf'];
      if (options.linearize !== false) args.push('--linearize');
      if (options.objectStreams !== false) args.push('--object-streams=generate');
      if (options.compressStreams !== false) args.push('--compress-streams=y');
      if (options.recompressFlate) args.push('--recompress-flate');
      args.push(inputPath, outputPath);

      await execAsync(args.join(' '), { timeout: 60000 });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Compresion agresiva: combina Ghostscript + QPDF para maxima reduccion.
   */
  async compressAggressive(pdfBuffer: Buffer): Promise<Buffer> {
    // Paso 1: Ghostscript reduce imagenes y recomprime
    const gsResult = await this.compressGhostscript(pdfBuffer, 'ebook');
    // Paso 2: QPDF optimiza estructura
    return this.compressQpdf(gsResult, {
      linearize: true,
      objectStreams: true,
      recompressFlate: true,
    });
  }

  /**
   * Reducir resolucion de imagenes dentro del PDF con Ghostscript.
   * @param maxDpi - Resolucion maxima para imagenes (default: 150)
   */
  async downscaleImages(
    pdfBuffer: Buffer,
    maxDpi: number = 150
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_downscaled.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const cmd = [
        'gs',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE -dQUIET -dBATCH',
        `-dColorImageResolution=${maxDpi}`,
        `-dGrayImageResolution=${maxDpi}`,
        `-dMonoImageResolution=${maxDpi}`,
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        `-sOutputFile=${outputPath}`,
        inputPath,
      ].join(' ');

      await execAsync(cmd, { timeout: 120000 });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Retorna informacion de tamano y estadisticas de compresion.
   */
  getCompressionStats(
    originalSize: number,
    compressedSize: number
  ): {
    originalSizeMB: string;
    compressedSizeMB: string;
    savedMB: string;
    reductionPercent: string;
  } {
    const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
    const saved = originalSize - compressedSize;
    const percent = ((saved / originalSize) * 100).toFixed(1);

    return {
      originalSizeMB: toMB(originalSize),
      compressedSizeMB: toMB(compressedSize),
      savedMB: toMB(saved),
      reductionPercent: percent,
    };
  }
}
```

---

## 9. Seguridad

### 9.1 Encriptacion y contrasenas

```typescript
// backend/src/modules/pdf-security/pdf-security.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument } from '@cantoo/pdf-lib';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

const execAsync = promisify(exec);

@Injectable()
export class PdfSecurityService {

  /**
   * Encripta un PDF con contrasena usando QPDF.
   * Soporta dos niveles de contrasena:
   * - userPassword: necesaria para abrir el PDF
   * - ownerPassword: necesaria para editar/imprimir
   */
  async encryptPdf(
    pdfBuffer: Buffer,
    options: {
      userPassword?: string;
      ownerPassword: string;
      keyLength?: 128 | 256;
      permissions?: {
        print?: boolean;
        modify?: boolean;
        extract?: boolean;
        annotate?: boolean;
      };
    }
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_encrypted.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const keyLength = options.keyLength || 256;
      const perms = options.permissions || {};

      const args = [
        'qpdf',
        `--encrypt`,
        `"${options.userPassword || ''}"`,  // user password (abrir)
        `"${options.ownerPassword}"`,       // owner password (editar)
        `${keyLength}`,
        // Permisos
        perms.print === false ? '--print=none' : '--print=full',
        perms.modify === false ? '--modify=none' : '--modify=all',
        perms.extract === false ? '--extract=n' : '--extract=y',
        perms.annotate === false ? '--annotate=n' : '--annotate=y',
        '--',
        inputPath,
        outputPath,
      ].join(' ');

      await execAsync(args, { timeout: 30000 });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Desencripta un PDF protegido con contrasena.
   */
  async decryptPdf(
    pdfBuffer: Buffer,
    password: string
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_decrypted.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const args = [
        'qpdf',
        `--password="${password}"`,
        '--decrypt',
        inputPath,
        outputPath,
      ].join(' ');

      await execAsync(args, { timeout: 30000 });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Elimina restricciones de un PDF (requiere owner password).
   */
  async removeRestrictions(
    pdfBuffer: Buffer,
    ownerPassword: string
  ): Promise<Buffer> {
    return this.decryptPdf(pdfBuffer, ownerPassword);
  }
}
```

### 9.2 Firmas digitales

```typescript
// backend/src/modules/pdf-security/pdf-signature.service.ts
import { Injectable } from '@nestjs/common';
import * as forge from 'node-forge';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as fs from 'fs/promises';

@Injectable()
export class PdfSignatureService {

  /**
   * Firma un PDF con un certificado PKCS#12 (.p12/.pfx).
   *
   * NOTA: La firma digital completa de PDFs es un proceso complejo.
   * Para produccion, considerar usar librerias especializadas como
   * @signpdf/signpdf o delegar a un servicio externo de firma.
   *
   * Esta implementacion muestra el flujo conceptual.
   */
  async signPdf(
    pdfBuffer: Buffer,
    p12Buffer: Buffer,
    p12Password: string,
    options?: {
      reason?: string;
      location?: string;
      contactInfo?: string;
    }
  ): Promise<Buffer> {
    // Extraer certificado y clave privada del P12
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

    // Obtener clave privada
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;

    // Obtener certificado
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certificate = certBags[forge.pki.oids.certBag]?.[0]?.cert;

    if (!privateKey || !certificate) {
      throw new Error('No se pudo extraer certificado o clave del archivo P12');
    }

    // Para firma PDF completa, usar @signpdf/signpdf:
    // npm install @signpdf/signpdf @signpdf/placeholder-plain @signpdf/signer-p12
    //
    // import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
    // import { P12Signer } from '@signpdf/signer-p12';
    // import signpdf from '@signpdf/signpdf';
    //
    // const pdfWithPlaceholder = plainAddPlaceholder({
    //   pdfBuffer,
    //   reason: options?.reason || 'Firma digital',
    //   location: options?.location,
    //   contactInfo: options?.contactInfo,
    // });
    //
    // const signer = new P12Signer(p12Buffer, { passphrase: p12Password });
    // const signedPdf = await signpdf.sign(pdfWithPlaceholder, signer);
    // return signedPdf;

    // Implementacion simplificada: agregar sello visual de firma
    return this.addVisualSignature(pdfBuffer, {
      signerName: certificate.subject.getField('CN')?.value || 'Firmante',
      reason: options?.reason,
      date: new Date(),
    });
  }

  /**
   * Agrega un sello visual de firma (no es una firma criptografica).
   */
  async addVisualSignature(
    pdfBuffer: Buffer,
    info: {
      signerName: string;
      reason?: string;
      date: Date;
      pageIndex?: number;
      x?: number;
      y?: number;
    }
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const page = doc.getPage(info.pageIndex ?? doc.getPageCount() - 1);
    const { StandardFonts, rgb } = await import('@cantoo/pdf-lib');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const x = info.x ?? 50;
    const y = info.y ?? 50;

    // Dibujar caja de firma
    page.drawRectangle({
      x, y, width: 250, height: 70,
      borderColor: rgb(0, 0, 0.5),
      borderWidth: 1.5,
      color: rgb(0.95, 0.95, 1),
      opacity: 0.9,
    });

    page.drawText('Firmado digitalmente por:', {
      x: x + 10, y: y + 52, size: 8, font,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText(info.signerName, {
      x: x + 10, y: y + 38, size: 11, font: boldFont,
      color: rgb(0, 0, 0.5),
    });
    if (info.reason) {
      page.drawText(`Razon: ${info.reason}`, {
        x: x + 10, y: y + 24, size: 8, font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
    page.drawText(`Fecha: ${info.date.toISOString().split('T')[0]}`, {
      x: x + 10, y: y + 10, size: 8, font,
      color: rgb(0.3, 0.3, 0.3),
    });

    return Buffer.from(await doc.save());
  }

  /**
   * Verifica si un PDF tiene firmas digitales.
   */
  async verifySignatures(pdfBuffer: Buffer): Promise<{
    hasSig: boolean;
    count: number;
    signers: string[];
  }> {
    // La verificacion completa requiere parsing del PDF a bajo nivel
    // Usar pdfsig (parte de poppler-utils) para verificacion robusta
    const tmpDir = (await import('os')).tmpdir();
    const tmpPath = `${tmpDir}/${(await import('uuid')).v4()}.pdf`;
    await fs.writeFile(tmpPath, pdfBuffer);

    try {
      const { stdout } = await (promisify(require('child_process').exec))(
        `pdfsig "${tmpPath}"`, { timeout: 10000 }
      );

      const signerMatches = stdout.match(/Signer Certificate Common Name: (.+)/g) || [];
      const signers = signerMatches.map(
        (m: string) => m.replace('Signer Certificate Common Name: ', '')
      );

      return {
        hasSig: signers.length > 0,
        count: signers.length,
        signers,
      };
    } catch {
      return { hasSig: false, count: 0, signers: [] };
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}
```

### 9.3 Redaccion de contenido

```typescript
/**
 * Redacta (censura) areas especificas de un PDF.
 * Dibuja rectangulos negros sobre las areas indicadas.
 */
async redactAreas(
  pdfBuffer: Buffer,
  redactions: Array<{
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);

  for (const redaction of redactions) {
    const page = doc.getPage(redaction.pageIndex);
    page.drawRectangle({
      x: redaction.x,
      y: redaction.y,
      width: redaction.width,
      height: redaction.height,
      color: rgb(0, 0, 0),
    });
  }

  return Buffer.from(await doc.save());
}
```

### 9.4 Sanitizacion de metadatos

```typescript
/**
 * Elimina todos los metadatos de un PDF.
 */
async sanitizeMetadata(pdfBuffer: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);

  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('');
  doc.setCreator('');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  return Buffer.from(await doc.save());
}
```

---

## 10. OCR

```typescript
// backend/src/modules/pdf-ocr/pdf-ocr.service.ts
import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import Tesseract from 'tesseract.js';

const execAsync = promisify(exec);

@Injectable()
export class PdfOcrService {

  /**
   * OCR con OCRmyPDF (recomendado para PDFs completos).
   * Agrega una capa de texto invisible sobre el PDF escaneado,
   * haciendolo buscable sin alterar la apariencia visual.
   *
   * Requisito: pip install ocrmypdf
   */
  async ocrWithOcrmypdf(
    pdfBuffer: Buffer,
    options: {
      language?: string;      // 'spa', 'eng', 'fra', 'deu', etc.
      deskew?: boolean;        // Corregir inclinacion
      cleanFinal?: boolean;    // Limpiar imagen final
      forceOcr?: boolean;      // OCR incluso si ya tiene texto
      optimizeLevel?: 0 | 1 | 2 | 3; // Nivel de optimizacion
    } = {}
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPath = path.join(tmpDir, `${uuid()}_ocr.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const args = ['ocrmypdf'];
      args.push('-l', options.language || 'spa+eng');
      if (options.deskew) args.push('--deskew');
      if (options.cleanFinal) args.push('--clean-final');
      if (options.forceOcr) args.push('--force-ocr');
      args.push('--optimize', String(options.optimizeLevel ?? 1));
      args.push('--output-type', 'pdf');
      args.push(inputPath, outputPath);

      await execAsync(args.join(' '), { timeout: 300000 }); // 5 min timeout
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * OCR con Tesseract CLI (para paginas individuales o imagenes).
   */
  async ocrWithTesseractCli(
    imageBuffer: Buffer,
    language: string = 'spa+eng'
  ): Promise<string> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.png`);
    const outputBase = path.join(tmpDir, `${uuid()}_result`);

    try {
      await fs.writeFile(inputPath, imageBuffer);
      await execAsync(
        `tesseract "${inputPath}" "${outputBase}" -l ${language}`,
        { timeout: 60000 }
      );
      return await fs.readFile(`${outputBase}.txt`, 'utf-8');
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(`${outputBase}.txt`).catch(() => {});
    }
  }

  /**
   * OCR con Tesseract.js (JavaScript puro, sin binarios del sistema).
   * Mas lento pero no requiere instalaciones adicionales.
   * Ideal para desarrollo local o cuando no se puede instalar Tesseract.
   */
  async ocrWithTesseractJs(
    imageBuffer: Buffer,
    language: string = 'spa'
  ): Promise<{
    text: string;
    confidence: number;
    words: Array<{ text: string; confidence: number; bbox: any }>;
  }> {
    const worker = await Tesseract.createWorker(language);
    try {
      const { data } = await worker.recognize(imageBuffer);
      return {
        text: data.text,
        confidence: data.confidence,
        words: data.words.map(w => ({
          text: w.text,
          confidence: w.confidence,
          bbox: w.bbox,
        })),
      };
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Convierte paginas PDF a imagenes y luego aplica OCR.
   * Util cuando ocrmypdf no esta disponible.
   */
  async ocrPdfPages(
    pdfBuffer: Buffer,
    options: {
      language?: string;
      dpi?: number;
      pages?: number[]; // paginas especificas (1-based)
    } = {}
  ): Promise<Array<{ page: number; text: string; confidence: number }>> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
    const outputPrefix = path.join(tmpDir, `${uuid()}_page`);
    const dpi = options.dpi || 300;

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      // Convertir PDF a imagenes con pdftoppm (poppler-utils)
      const pageArgs = options.pages
        ? `-f ${Math.min(...options.pages)} -l ${Math.max(...options.pages)}`
        : '';
      await execAsync(
        `pdftoppm -png -r ${dpi} ${pageArgs} "${inputPath}" "${outputPrefix}"`,
        { timeout: 120000 }
      );

      // Encontrar imagenes generadas
      const files = await fs.readdir(tmpDir);
      const pageImages = files
        .filter(f => f.startsWith(path.basename(outputPrefix)))
        .sort();

      const results = [];
      for (let i = 0; i < pageImages.length; i++) {
        const imgPath = path.join(tmpDir, pageImages[i]);
        const imgBuffer = await fs.readFile(imgPath);
        const ocrResult = await this.ocrWithTesseractJs(
          imgBuffer,
          options.language || 'spa'
        );
        results.push({
          page: i + 1,
          text: ocrResult.text,
          confidence: ocrResult.confidence,
        });
        await fs.unlink(imgPath).catch(() => {});
      }

      return results;
    } finally {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}
```

---

## 11. Extraccion de Datos

### 11.1 Extraer texto

```typescript
// backend/src/modules/pdf-extract/pdf-extract.service.ts
import { Injectable } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuid } from 'uuid';

const execAsync = promisify(exec);

@Injectable()
export class PdfExtractService {

  /**
   * Extrae todo el texto de un PDF usando pdf-parse.
   */
  async extractText(pdfBuffer: Buffer): Promise<{
    text: string;
    numPages: number;
    info: Record<string, any>;
  }> {
    const data = await pdfParse(pdfBuffer);
    return {
      text: data.text,
      numPages: data.numpages,
      info: data.info,
    };
  }

  /**
   * Extrae texto por pagina usando pdftotext (poppler-utils).
   * Mas preciso que pdf-parse para el layout.
   */
  async extractTextByPage(
    pdfBuffer: Buffer,
    options: {
      layout?: boolean;  // Mantener layout original
      raw?: boolean;     // Texto sin formato
    } = {}
  ): Promise<Array<{ page: number; text: string }>> {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${uuid()}.pdf`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      // Obtener numero de paginas
      const { stdout: infoOutput } = await execAsync(
        `pdfinfo "${inputPath}"`, { timeout: 10000 }
      );
      const pagesMatch = infoOutput.match(/Pages:\s+(\d+)/);
      const totalPages = parseInt(pagesMatch?.[1] || '1');

      const results = [];
      for (let i = 1; i <= totalPages; i++) {
        const args = ['pdftotext'];
        if (options.layout) args.push('-layout');
        if (options.raw) args.push('-raw');
        args.push('-f', String(i), '-l', String(i));
        args.push(`"${inputPath}"`, '-');

        const { stdout } = await execAsync(args.join(' '), { timeout: 10000 });
        results.push({ page: i, text: stdout });
      }

      return results;
    } finally {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}
```

### 11.2 Extraer imagenes

```typescript
/**
 * Extrae imagenes embebidas de un PDF usando pdfimages (poppler-utils).
 */
async extractImages(
  pdfBuffer: Buffer,
  format: 'png' | 'jpeg' = 'png'
): Promise<Array<{ page: number; data: Buffer; filename: string }>> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const inputPath = path.join(tmpDir, `${id}.pdf`);
  const outputPrefix = path.join(tmpDir, `${id}_img`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    const formatFlag = format === 'png' ? '-png' : '-j';
    await execAsync(
      `pdfimages ${formatFlag} "${inputPath}" "${outputPrefix}"`,
      { timeout: 60000 }
    );

    const files = await fs.readdir(tmpDir);
    const imageFiles = files
      .filter(f => f.startsWith(`${id}_img`))
      .sort();

    const results = [];
    for (const filename of imageFiles) {
      const filePath = path.join(tmpDir, filename);
      const data = await fs.readFile(filePath);
      // pdfimages nombra los archivos como prefix-NNN.ext
      const pageMatch = filename.match(/-(\d+)\./);
      results.push({
        page: pageMatch ? parseInt(pageMatch[1]) + 1 : 0,
        data,
        filename,
      });
      await fs.unlink(filePath).catch(() => {});
    }

    return results;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}
```

### 11.3 Extraer tablas

```typescript
/**
 * Extrae tablas de un PDF y las convierte a JSON/CSV.
 * Usa tabula-java via tabula-js (requiere Java instalado)
 * o como alternativa, usa Camelot (Python).
 *
 * Alternativa sin Java: usar pdf-table-extractor o custom con pdf-parse.
 */
async extractTables(
  pdfBuffer: Buffer,
  options: {
    pages?: string;        // '1,2,3' o 'all'
    format?: 'json' | 'csv';
    lattice?: boolean;     // Tablas con bordes visibles
    stream?: boolean;      // Tablas sin bordes (inferir por whitespace)
  } = {}
): Promise<any[]> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
  const outputPath = path.join(tmpDir, `${uuid()}_tables.json`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    // Usando tabula-java via CLI
    // Requiere: java -jar tabula.jar
    const args = [
      'java', '-jar', '/usr/local/lib/tabula.jar',
      '-f', 'JSON',
      '-p', options.pages || 'all',
    ];
    if (options.lattice) args.push('-l'); // modo lattice
    if (options.stream) args.push('-t');  // modo stream
    args.push('-o', outputPath);
    args.push(inputPath);

    await execAsync(args.join(' '), { timeout: 120000 });
    const content = await fs.readFile(outputPath, 'utf-8');
    return JSON.parse(content);

  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Alternativa: extraer tablas con Python Camelot.
 * Mas preciso que Tabula para muchos casos.
 * Requiere: pip install camelot-py[cv]
 */
async extractTablesWithCamelot(
  pdfBuffer: Buffer,
  pages: string = 'all'
): Promise<any[]> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `${uuid()}.pdf`);
  const outputPath = path.join(tmpDir, `${uuid()}_camelot.json`);

  const pythonScript = `
import camelot
import json
import sys

tables = camelot.read_pdf('${inputPath}', pages='${pages}')
result = []
for table in tables:
    result.append({
        'page': table.page,
        'data': table.df.values.tolist(),
        'headers': table.df.columns.tolist(),
        'accuracy': table.accuracy
    })
with open('${outputPath}', 'w') as f:
    json.dump(result, f)
`;

  try {
    await fs.writeFile(inputPath, pdfBuffer);
    const scriptPath = path.join(tmpDir, `${uuid()}_extract.py`);
    await fs.writeFile(scriptPath, pythonScript);

    await execAsync(`python3 "${scriptPath}"`, { timeout: 120000 });
    const content = await fs.readFile(outputPath, 'utf-8');
    return JSON.parse(content);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
```

### 11.4 Extraer metadatos

```typescript
/**
 * Extrae metadatos completos de un PDF.
 */
async extractMetadata(pdfBuffer: Buffer): Promise<{
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: Date | null;
  modificationDate: Date | null;
  pageCount: number;
  pageSize: { width: number; height: number };
  isEncrypted: boolean;
  pdfVersion: string;
}> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(pdfBuffer, {
    ignoreEncryption: true,
  });

  const firstPage = doc.getPage(0);
  const { width, height } = firstPage.getSize();

  return {
    title: doc.getTitle() || null,
    author: doc.getAuthor() || null,
    subject: doc.getSubject() || null,
    keywords: doc.getKeywords() || null,
    creator: doc.getCreator() || null,
    producer: doc.getProducer() || null,
    creationDate: doc.getCreationDate() || null,
    modificationDate: doc.getModificationDate() || null,
    pageCount: doc.getPageCount(),
    pageSize: { width, height },
    isEncrypted: false, // pdf-lib lanza error si esta encriptado
    pdfVersion: '', // requiere parsing manual del header
  };
}

/**
 * Extrae metadatos detallados con pdfinfo (poppler-utils).
 * Mas completo que pdf-lib para informacion del archivo.
 */
async extractMetadataDetailed(pdfBuffer: Buffer): Promise<Record<string, string>> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `${uuid()}.pdf`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);
    const { stdout } = await execAsync(
      `pdfinfo "${inputPath}"`, { timeout: 10000 }
    );

    const metadata: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
    }
    return metadata;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}
```

---

## 12. Conversiones

### 12.1 PDF a Imagen (PNG/JPEG/TIFF)

```typescript
// backend/src/modules/pdf-convert/pdf-convert.service.ts
import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import * as sharp from 'sharp';

const execAsync = promisify(exec);

@Injectable()
export class PdfConvertService {

  /**
   * Convierte paginas de PDF a imagenes.
   * Usa pdftoppm (poppler-utils) para alta calidad.
   */
  async pdfToImages(
    pdfBuffer: Buffer,
    options: {
      format?: 'png' | 'jpeg' | 'tiff';
      dpi?: number;
      pages?: number[];       // Paginas especificas (1-based)
      singleFile?: boolean;   // Solo primera pagina
    } = {}
  ): Promise<Array<{ page: number; data: Buffer; filename: string }>> {
    const tmpDir = os.tmpdir();
    const id = uuid();
    const inputPath = path.join(tmpDir, `${id}.pdf`);
    const outputPrefix = path.join(tmpDir, `${id}_page`);
    const format = options.format || 'png';
    const dpi = options.dpi || 300;

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      const formatFlags: Record<string, string> = {
        png: '-png',
        jpeg: '-jpeg',
        tiff: '-tiff',
      };

      const args = [
        'pdftoppm',
        formatFlags[format],
        '-r', String(dpi),
      ];

      if (options.singleFile) {
        args.push('-singlefile', '-f', '1', '-l', '1');
      } else if (options.pages) {
        args.push('-f', String(Math.min(...options.pages)));
        args.push('-l', String(Math.max(...options.pages)));
      }

      args.push(`"${inputPath}"`, `"${outputPrefix}"`);
      await execAsync(args.join(' '), { timeout: 120000 });

      // Recoger archivos generados
      const files = await fs.readdir(tmpDir);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const outputFiles = files
        .filter(f => f.startsWith(`${id}_page`) && f.endsWith(`.${ext}`))
        .sort();

      const results = [];
      for (let i = 0; i < outputFiles.length; i++) {
        const filePath = path.join(tmpDir, outputFiles[i]);
        let data = await fs.readFile(filePath);

        // Optimizar con sharp si es necesario
        if (format === 'jpeg') {
          data = await sharp(data).jpeg({ quality: 85 }).toBuffer();
        }

        results.push({
          page: i + 1,
          data,
          filename: `page_${i + 1}.${ext}`,
        });
        await fs.unlink(filePath).catch(() => {});
      }

      return results;
    } finally {
      await fs.unlink(inputPath).catch(() => {});
    }
  }

  /**
   * Convierte un PDF a un unico TIFF multipagina.
   */
  async pdfToMultiPageTiff(
    pdfBuffer: Buffer,
    dpi: number = 300
  ): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const id = uuid();
    const inputPath = path.join(tmpDir, `${id}.pdf`);
    const outputPath = path.join(tmpDir, `${id}.tiff`);

    try {
      await fs.writeFile(inputPath, pdfBuffer);

      await execAsync(
        `gs -sDEVICE=tiffg4 -r${dpi} -dNOPAUSE -dBATCH ` +
        `-sOutputFile="${outputPath}" "${inputPath}"`,
        { timeout: 120000 }
      );

      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }
}
```

### 12.2 Imagen a PDF

```typescript
/**
 * Convierte una o mas imagenes a PDF.
 */
async imagesToPdf(
  imageBuffers: Array<{ data: Buffer; type: 'png' | 'jpeg' }>,
  options: {
    pageSize?: 'a4' | 'letter' | 'fit'; // 'fit' = tamano de la imagen
    margin?: number;
  } = {}
): Promise<Buffer> {
  const { PDFDocument, PageSizes } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const margin = options.margin ?? 0;

  for (const img of imageBuffers) {
    const image = img.type === 'png'
      ? await doc.embedPng(img.data)
      : await doc.embedJpg(img.data);

    let pageWidth: number, pageHeight: number;

    if (options.pageSize === 'a4') {
      [pageWidth, pageHeight] = PageSizes.A4;
    } else if (options.pageSize === 'letter') {
      [pageWidth, pageHeight] = PageSizes.Letter;
    } else {
      // 'fit': ajustar pagina al tamano de la imagen
      pageWidth = image.width + margin * 2;
      pageHeight = image.height + margin * 2;
    }

    const page = doc.addPage([pageWidth, pageHeight]);

    // Escalar imagen para que quepa en la pagina con margen
    const availWidth = pageWidth - margin * 2;
    const availHeight = pageHeight - margin * 2;
    const scale = Math.min(
      availWidth / image.width,
      availHeight / image.height,
      1 // no agrandar
    );
    const imgWidth = image.width * scale;
    const imgHeight = image.height * scale;

    // Centrar en la pagina
    const x = (pageWidth - imgWidth) / 2;
    const y = (pageHeight - imgHeight) / 2;

    page.drawImage(image, { x, y, width: imgWidth, height: imgHeight });
  }

  return Buffer.from(await doc.save());
}
```

### 12.3 PDF a HTML

```typescript
/**
 * Convierte un PDF a HTML usando pdftohtml (poppler-utils).
 */
async pdfToHtml(
  pdfBuffer: Buffer,
  options: {
    singlePage?: boolean;     // Todo en una sola pagina HTML
    embedImages?: boolean;    // Embeber imagenes como base64
    noFrames?: boolean;       // Sin frames HTML
  } = {}
): Promise<string> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const inputPath = path.join(tmpDir, `${id}.pdf`);
  const outputPath = path.join(tmpDir, `${id}.html`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    const args = ['pdftohtml'];
    if (options.singlePage) args.push('-s');
    if (options.noFrames !== false) args.push('-noframes');
    args.push('-enc', 'UTF-8');
    args.push(`"${inputPath}"`, `"${outputPath}"`);

    await execAsync(args.join(' '), { timeout: 60000 });

    // pdftohtml sin -s genera outputPath como directorio
    // con -noframes genera un solo .html
    const htmlContent = await fs.readFile(
      outputPath.replace('.html', 's.html'), // pdftohtml agrega 's'
      'utf-8'
    ).catch(() => fs.readFile(outputPath, 'utf-8'));

    return htmlContent;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    // Limpiar archivos generados
    const files = await fs.readdir(tmpDir);
    for (const f of files.filter(f => f.startsWith(id))) {
      await fs.unlink(path.join(tmpDir, f)).catch(() => {});
    }
  }
}
```

### 12.4 HTML a PDF

```typescript
/**
 * Convierte HTML a PDF usando Puppeteer.
 * Mejor calidad y soporte CSS que WeasyPrint para contenido web moderno.
 */
async htmlToPdf(
  htmlContent: string,
  options: {
    format?: 'A4' | 'Letter' | 'Legal';
    landscape?: boolean;
    margin?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
    printBackground?: boolean;
    headerTemplate?: string;
    footerTemplate?: string;
    scale?: number;
  } = {}
): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      landscape: options.landscape || false,
      printBackground: options.printBackground ?? true,
      margin: options.margin || {
        top: '20mm', right: '15mm', bottom: '20mm', left: '15mm',
      },
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      displayHeaderFooter: !!(options.headerTemplate || options.footerTemplate),
      scale: options.scale || 1,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Convierte una URL a PDF.
 */
async urlToPdf(
  url: string,
  options?: Parameters<PdfConvertService['htmlToPdf']>[1]
): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: options?.format || 'A4',
      printBackground: options?.printBackground ?? true,
      margin: options?.margin || {
        top: '20mm', right: '15mm', bottom: '20mm', left: '15mm',
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
```

### 12.5 Office (DOCX/XLSX/PPTX) a PDF

```typescript
/**
 * Convierte documentos Office a PDF usando LibreOffice.
 * Soporta: DOCX, DOC, XLSX, XLS, PPTX, PPT, ODT, ODS, ODP, RTF, TXT
 */
async officeToPdf(
  fileBuffer: Buffer,
  originalFilename: string
): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const ext = path.extname(originalFilename);
  const inputPath = path.join(tmpDir, `${id}${ext}`);

  try {
    await fs.writeFile(inputPath, fileBuffer);

    // LibreOffice headless conversion
    await execAsync(
      `libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${inputPath}"`,
      { timeout: 120000 }
    );

    const outputPath = inputPath.replace(ext, '.pdf');
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    const outputPath = inputPath.replace(ext, '.pdf');
    // No borrar el output, lo retornamos como buffer arriba
  }
}
```

### 12.6 PDF a Excel/CSV

```typescript
/**
 * Convierte tablas de un PDF a Excel (.xlsx).
 * Requiere tabula-java o camelot como backend.
 */
async pdfToExcel(pdfBuffer: Buffer, pages: string = 'all'): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const inputPath = path.join(tmpDir, `${id}.pdf`);
  const outputPath = path.join(tmpDir, `${id}.xlsx`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    // Alternativa 1: tabula-java directo a CSV, luego a XLSX con exceljs
    await execAsync(
      `java -jar /usr/local/lib/tabula.jar -f CSV -p ${pages} ` +
      `-o "${outputPath.replace('.xlsx', '.csv')}" "${inputPath}"`,
      { timeout: 60000 }
    );

    // Convertir CSV a XLSX usando una libreria como exceljs
    // npm install exceljs
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');

    const csvContent = await fs.readFile(
      outputPath.replace('.xlsx', '.csv'), 'utf-8'
    );
    const rows = csvContent.split('\n').map(row =>
      row.split(',').map(cell => cell.replace(/^"|"$/g, '').trim())
    );
    rows.forEach(row => worksheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}

/**
 * Convierte tablas de un PDF a CSV.
 */
async pdfToCsv(pdfBuffer: Buffer, pages: string = 'all'): Promise<string> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const inputPath = path.join(tmpDir, `${id}.pdf`);
  const outputPath = path.join(tmpDir, `${id}.csv`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);
    await execAsync(
      `java -jar /usr/local/lib/tabula.jar -f CSV -p ${pages} ` +
      `-o "${outputPath}" "${inputPath}"`,
      { timeout: 60000 }
    );
    return await fs.readFile(outputPath, 'utf-8');
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
```

### 12.7 eBook (EPUB/MOBI) a PDF

```typescript
/**
 * Convierte eBooks a PDF usando Calibre.
 * Soporta: EPUB, MOBI, AZW3, FB2, LIT, PDB, etc.
 */
async ebookToPdf(
  fileBuffer: Buffer,
  originalFilename: string,
  options: {
    paperSize?: 'a4' | 'letter';
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    fontSize?: number;
  } = {}
): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = uuid();
  const ext = path.extname(originalFilename);
  const inputPath = path.join(tmpDir, `${id}${ext}`);
  const outputPath = path.join(tmpDir, `${id}.pdf`);

  try {
    await fs.writeFile(inputPath, fileBuffer);

    const args = ['ebook-convert', `"${inputPath}"`, `"${outputPath}"`];

    if (options.paperSize) {
      const sizes = {
        a4: { w: 210, h: 297 },
        letter: { w: 216, h: 279 },
      };
      const size = sizes[options.paperSize];
      args.push(`--pdf-page-width=${size.w}`, `--pdf-page-height=${size.h}`);
    }
    if (options.marginTop) args.push(`--pdf-page-margin-top=${options.marginTop}`);
    if (options.marginBottom) args.push(`--pdf-page-margin-bottom=${options.marginBottom}`);
    if (options.marginLeft) args.push(`--pdf-page-margin-left=${options.marginLeft}`);
    if (options.marginRight) args.push(`--pdf-page-margin-right=${options.marginRight}`);
    if (options.fontSize) args.push(`--pdf-default-font-size=${options.fontSize}`);

    await execAsync(args.join(' '), { timeout: 180000 });
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
```

### 12.8 Markdown a PDF

```typescript
/**
 * Convierte Markdown a PDF.
 * Paso 1: Markdown -> HTML (con marked)
 * Paso 2: HTML -> PDF (con Puppeteer)
 */
async markdownToPdf(
  markdown: string,
  options: {
    cssStyles?: string;  // CSS personalizado
    format?: 'A4' | 'Letter';
  } = {}
): Promise<Buffer> {
  const { marked } = await import('marked');
  const htmlBody = await marked(markdown);

  const defaultCss = `
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre code {
      display: block;
      padding: 12px;
      overflow-x: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th { background: #f2f2f2; }
    img { max-width: 100%; }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 0;
      padding-left: 16px;
      color: #666;
    }
  `;

  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <style>${options.cssStyles || defaultCss}</style>
</head><body>${htmlBody}</body></html>`;

  return this.htmlToPdf(html, { format: options.format || 'A4' });
}
```

### 12.9 PDF a texto plano

```typescript
/**
 * Convierte PDF a texto plano limpio.
 */
async pdfToText(
  pdfBuffer: Buffer,
  options: {
    preserveLayout?: boolean;
    pageBreaks?: boolean;
  } = {}
): Promise<string> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `${uuid()}.pdf`);

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    const args = ['pdftotext'];
    if (options.preserveLayout) args.push('-layout');
    args.push('-enc', 'UTF-8');
    args.push(`"${inputPath}"`, '-'); // '-' = stdout

    const { stdout } = await execAsync(args.join(' '), { timeout: 30000 });
    return stdout;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}
```

---

## 13. Anotaciones

```typescript
// backend/src/modules/pdf-annotate/pdf-annotate.service.ts
import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';

@Injectable()
export class PdfAnnotateService {

  /**
   * Agrega rectangulos/resaltado a un PDF.
   */
  async addHighlights(
    pdfBuffer: Buffer,
    highlights: Array<{
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: { r: number; g: number; b: number };
      opacity?: number;
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);

    for (const h of highlights) {
      const page = doc.getPage(h.pageIndex);
      const color = h.color
        ? rgb(h.color.r / 255, h.color.g / 255, h.color.b / 255)
        : rgb(1, 1, 0); // amarillo por defecto

      page.drawRectangle({
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
        color,
        opacity: h.opacity ?? 0.3,
      });
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega lineas al PDF.
   */
  async addLines(
    pdfBuffer: Buffer,
    lines: Array<{
      pageIndex: number;
      start: { x: number; y: number };
      end: { x: number; y: number };
      thickness?: number;
      color?: { r: number; g: number; b: number };
      opacity?: number;
      dashArray?: number[];
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);

    for (const line of lines) {
      const page = doc.getPage(line.pageIndex);
      const color = line.color
        ? rgb(line.color.r / 255, line.color.g / 255, line.color.b / 255)
        : rgb(1, 0, 0);

      page.drawLine({
        start: line.start,
        end: line.end,
        thickness: line.thickness ?? 2,
        color,
        opacity: line.opacity ?? 1,
        dashArray: line.dashArray,
      });
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega circulos/elipses al PDF.
   */
  async addCircles(
    pdfBuffer: Buffer,
    circles: Array<{
      pageIndex: number;
      x: number;
      y: number;
      size: number; // radio
      borderColor?: { r: number; g: number; b: number };
      fillColor?: { r: number; g: number; b: number };
      borderWidth?: number;
      opacity?: number;
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);

    for (const c of circles) {
      const page = doc.getPage(c.pageIndex);

      page.drawEllipse({
        x: c.x,
        y: c.y,
        xScale: c.size,
        yScale: c.size,
        borderColor: c.borderColor
          ? rgb(c.borderColor.r / 255, c.borderColor.g / 255, c.borderColor.b / 255)
          : rgb(1, 0, 0),
        color: c.fillColor
          ? rgb(c.fillColor.r / 255, c.fillColor.g / 255, c.fillColor.b / 255)
          : undefined,
        borderWidth: c.borderWidth ?? 2,
        opacity: c.opacity ?? 1,
      });
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega notas adhesivas (sticky notes) como comentarios de texto.
   */
  async addStickyNotes(
    pdfBuffer: Buffer,
    notes: Array<{
      pageIndex: number;
      x: number;
      y: number;
      text: string;
      color?: 'yellow' | 'blue' | 'green' | 'red';
    }>
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const colorMap = {
      yellow: rgb(1, 1, 0.7),
      blue: rgb(0.7, 0.85, 1),
      green: rgb(0.7, 1, 0.7),
      red: rgb(1, 0.7, 0.7),
    };

    for (const note of notes) {
      const page = doc.getPage(note.pageIndex);
      const bgColor = colorMap[note.color || 'yellow'];
      const noteWidth = 150;
      const fontSize = 8;
      const lineHeight = fontSize * 1.3;

      // Dividir texto en lineas
      const words = note.text.split(' ');
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (font.widthOfTextAtSize(testLine, fontSize) > noteWidth - 16) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      const noteHeight = lines.length * lineHeight + 16;

      // Dibujar fondo de nota
      page.drawRectangle({
        x: note.x,
        y: note.y - noteHeight,
        width: noteWidth,
        height: noteHeight,
        color: bgColor,
        borderColor: rgb(0.5, 0.5, 0.5),
        borderWidth: 0.5,
        opacity: 0.95,
      });

      // Dibujar texto
      for (let i = 0; i < lines.length; i++) {
        page.drawText(lines[i], {
          x: note.x + 8,
          y: note.y - 12 - (i * lineHeight),
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
    }

    return Buffer.from(await doc.save());
  }

  /**
   * Agrega una firma manuscrita (imagen) al PDF.
   * Se espera que el frontend capture la firma con signature_pad.
   */
  async addSignatureImage(
    pdfBuffer: Buffer,
    signatureImageBuffer: Buffer,
    options: {
      pageIndex: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdfBuffer);
    const page = doc.getPage(options.pageIndex);

    const signatureImage = await doc.embedPng(signatureImageBuffer);
    page.drawImage(signatureImage, {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    });

    return Buffer.from(await doc.save());
  }
}
```

---

## 14. Visualizacion en Frontend

### PDF Viewer con PDF.js

```typescript
// frontend/src/components/PdfViewer.tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configurar worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfViewerProps {
  file: File | Uint8Array | string; // File, bytes, o URL
  initialPage?: number;
  scale?: number;
  onPageChange?: (page: number, total: number) => void;
  onDocumentLoad?: (totalPages: number) => void;
}

export function PdfViewer({
  file,
  initialPage = 1,
  scale = 1.5,
  onPageChange,
  onDocumentLoad,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [currentScale, setCurrentScale] = useState(scale);

  // Cargar documento
  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      let source: any;
      if (file instanceof File) {
        source = { data: await file.arrayBuffer() };
      } else if (file instanceof Uint8Array) {
        source = { data: file };
      } else {
        source = { url: file };
      }

      const doc = await pdfjsLib.getDocument(source).promise;
      if (!cancelled) {
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        onDocumentLoad?.(doc.numPages);
      }
    }

    loadDocument();
    return () => { cancelled = true; };
  }, [file]);

  // Renderizar pagina actual
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    async function renderPage() {
      const page = await pdfDoc!.getPage(currentPage);
      const viewport = page.getViewport({ scale: currentScale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;
    }

    renderPage();
    onPageChange?.(currentPage, totalPages);
  }, [pdfDoc, currentPage, currentScale]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Controles */}
      <div className="flex items-center gap-4 p-2 bg-gray-100 rounded-lg">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-3 py-1 bg-white border rounded disabled:opacity-50"
        >
          Anterior
        </button>

        <span className="text-sm">
          Pagina{' '}
          <input
            type="number"
            value={currentPage}
            onChange={e => goToPage(parseInt(e.target.value) || 1)}
            className="w-12 text-center border rounded"
            min={1}
            max={totalPages}
          />{' '}
          de {totalPages}
        </span>

        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="px-3 py-1 bg-white border rounded disabled:opacity-50"
        >
          Siguiente
        </button>

        <span className="mx-2 text-gray-300">|</span>

        <button
          onClick={() => setCurrentScale(s => Math.max(0.5, s - 0.25))}
          className="px-2 py-1 bg-white border rounded"
        >
          -
        </button>
        <span className="text-sm w-16 text-center">
          {Math.round(currentScale * 100)}%
        </span>
        <button
          onClick={() => setCurrentScale(s => Math.min(3, s + 0.25))}
          className="px-2 py-1 bg-white border rounded"
        >
          +
        </button>
      </div>

      {/* Canvas del PDF */}
      <div className="border shadow-lg overflow-auto max-h-[80vh]">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
```

### Thumbnails de paginas

```typescript
// frontend/src/components/PageThumbnails.tsx
'use client';
import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

interface PageThumbnailsProps {
  file: File;
  onPageSelect?: (pageIndex: number) => void;
  selectedPages?: number[];
  onSelectionChange?: (pages: number[]) => void;
}

export function PageThumbnails({
  file,
  onPageSelect,
  selectedPages = [],
  onSelectionChange,
}: PageThumbnailsProps) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    async function generateThumbnails() {
      const data = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data }).promise;
      setTotalPages(doc.numPages);

      const thumbs: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 }); // Escala pequena
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        thumbs.push(canvas.toDataURL('image/jpeg', 0.7));
      }
      setThumbnails(thumbs);
    }

    generateThumbnails();
  }, [file]);

  const togglePage = (index: number) => {
    const newSelection = selectedPages.includes(index)
      ? selectedPages.filter(p => p !== index)
      : [...selectedPages, index].sort((a, b) => a - b);
    onSelectionChange?.(newSelection);
  };

  return (
    <div className="grid grid-cols-4 gap-3 p-4 max-h-[70vh] overflow-y-auto">
      {thumbnails.map((thumb, index) => (
        <div
          key={index}
          onClick={() => {
            onPageSelect?.(index);
            togglePage(index);
          }}
          className={`
            cursor-pointer border-2 rounded-lg overflow-hidden
            transition-all hover:shadow-lg
            ${selectedPages.includes(index)
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-gray-200'
            }
          `}
        >
          <img
            src={thumb}
            alt={`Pagina ${index + 1}`}
            className="w-full"
          />
          <div className="text-center text-xs py-1 bg-gray-50">
            {index + 1}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 15. Operaciones en el Cliente (sin servidor)

Estas operaciones se ejecutan completamente en el navegador usando `pdf-lib`, sin necesidad de enviar el archivo al backend.

```typescript
// frontend/src/lib/pdf-client.ts
import { PDFDocument, degrees, rgb, StandardFonts } from '@cantoo/pdf-lib';

/**
 * Utilidades PDF que se ejecutan 100% en el navegador.
 * No requieren conexion al servidor.
 */
export const PdfClientOps = {

  /** Cargar un File como PDFDocument */
  async load(file: File): Promise<PDFDocument> {
    const buffer = await file.arrayBuffer();
    return PDFDocument.load(buffer);
  },

  /** Guardar PDFDocument como Blob descargable */
  async saveAsBlob(doc: PDFDocument): Promise<Blob> {
    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  },

  /** Descargar un PDFDocument */
  async download(doc: PDFDocument, filename: string) {
    const blob = await this.saveAsBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Merge: unir multiples archivos */
  async merge(files: File[]): Promise<PDFDocument> {
    const merged = await PDFDocument.create();
    for (const file of files) {
      const src = await this.load(file);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    return merged;
  },

  /** Split: dividir en paginas individuales */
  async split(file: File): Promise<PDFDocument[]> {
    const src = await this.load(file);
    const result: PDFDocument[] = [];
    for (let i = 0; i < src.getPageCount(); i++) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [i]);
      doc.addPage(page);
      result.push(doc);
    }
    return result;
  },

  /** Eliminar paginas */
  async removePages(file: File, pagesToRemove: number[]): Promise<PDFDocument> {
    const src = await this.load(file);
    const doc = await PDFDocument.create();
    const keepIndices = src.getPageIndices()
      .filter(i => !pagesToRemove.includes(i));
    const pages = await doc.copyPages(src, keepIndices);
    pages.forEach(p => doc.addPage(p));
    return doc;
  },

  /** Reordenar paginas */
  async reorder(file: File, newOrder: number[]): Promise<PDFDocument> {
    const src = await this.load(file);
    const doc = await PDFDocument.create();
    for (const i of newOrder) {
      const [page] = await doc.copyPages(src, [i]);
      doc.addPage(page);
    }
    return doc;
  },

  /** Rotar paginas */
  async rotate(
    file: File,
    rotations: Record<number, number>
  ): Promise<PDFDocument> {
    const doc = await this.load(file);
    for (const [idx, deg] of Object.entries(rotations)) {
      const page = doc.getPage(parseInt(idx));
      const current = page.getRotation().angle;
      page.setRotation(degrees(current + deg));
    }
    return doc;
  },

  /** Agregar texto */
  async addText(
    file: File,
    pageIndex: number,
    text: string,
    x: number,
    y: number,
    fontSize: number = 12
  ): Promise<PDFDocument> {
    const doc = await this.load(file);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(pageIndex);
    page.drawText(text, { x, y, size: fontSize, font });
    return doc;
  },

  /** Agregar marca de agua de texto */
  async watermark(
    file: File,
    text: string,
    opacity: number = 0.15
  ): Promise<PDFDocument> {
    const doc = await this.load(file);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 60;

    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: (width - textWidth * 0.7) / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity,
        rotate: degrees(-45),
      });
    }
    return doc;
  },

  /** Obtener info basica del PDF */
  async getInfo(file: File): Promise<{
    pageCount: number;
    title: string | undefined;
    author: string | undefined;
    pages: Array<{ width: number; height: number }>;
  }> {
    const doc = await this.load(file);
    return {
      pageCount: doc.getPageCount(),
      title: doc.getTitle(),
      author: doc.getAuthor(),
      pages: doc.getPages().map(p => p.getSize()),
    };
  },
};
```

### Hook de React para operaciones PDF

```typescript
// frontend/src/hooks/usePdfOperation.ts
'use client';
import { useState, useCallback } from 'react';
import { PdfClientOps } from '@/lib/pdf-client';

interface OperationState {
  loading: boolean;
  error: string | null;
  progress: number;
}

export function usePdfOperation() {
  const [state, setState] = useState<OperationState>({
    loading: false,
    error: null,
    progress: 0,
  });

  const execute = useCallback(async <T>(
    operation: () => Promise<T>,
    label?: string
  ): Promise<T | null> => {
    setState({ loading: true, error: null, progress: 0 });
    try {
      const result = await operation();
      setState({ loading: false, error: null, progress: 100 });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setState({ loading: false, error: message, progress: 0 });
      return null;
    }
  }, []);

  return { ...state, execute };
}
```

---

## 16. Docker y Despliegue

### Dockerfile

```dockerfile
# docker/Dockerfile
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# -------

FROM node:22-slim AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# -------

FROM node:22-slim AS production

# Instalar dependencias del sistema para herramientas PDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Poppler (pdftotext, pdftohtml, pdftoppm, pdfimages, pdfinfo, pdfsig)
    poppler-utils \
    # Ghostscript (compresion, renderizado)
    ghostscript \
    # QPDF (compresion, encriptacion, optimizacion)
    qpdf \
    # Tesseract OCR + idiomas
    tesseract-ocr \
    tesseract-ocr-spa \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    tesseract-ocr-deu \
    tesseract-ocr-por \
    # LibreOffice (conversion de documentos Office)
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    # Calibre (conversion de eBooks)
    calibre \
    # ImageMagick (imagenes)
    imagemagick \
    # OCRmyPDF
    ocrmypdf \
    # FFmpeg (video)
    ffmpeg \
    # Unpaper (limpieza de escaneos)
    unpaper \
    # Fuentes
    fonts-liberation \
    fonts-noto-core \
    # Python para scripts auxiliares
    python3 \
    python3-pip \
    # Limpieza
    && rm -rf /var/lib/apt/lists/*

# Instalar Puppeteer dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar backend
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./

# Copiar frontend build
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/public ./frontend/public
COPY --from=frontend-builder /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-builder /app/frontend/package.json ./frontend/

# Directorio temporal para procesamiento
RUN mkdir -p /tmp/pdf-processing && chmod 777 /tmp/pdf-processing

EXPOSE 3000 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/main.js"]
```

### Docker Compose

```yaml
# docker/docker-compose.yml
version: '3.8'

services:
  pdf-suite:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"   # Frontend Next.js
      - "3001:3001"   # Backend NestJS API
    environment:
      - NODE_ENV=production
      - MAX_FILE_SIZE=100MB
      - TEMP_DIR=/tmp/pdf-processing
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
    volumes:
      - pdf-temp:/tmp/pdf-processing
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G    # LibreOffice y Ghostscript necesitan memoria
        reservations:
          memory: 1G

  # Redis para colas de tareas pesadas (opcional)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  pdf-temp:
  redis-data:
```

---

## 17. API REST Completa

### Resumen de todos los endpoints

```
POST /api/v1/pdf/pages/reorder       - Reordenar paginas
POST /api/v1/pdf/pages/remove        - Eliminar paginas
POST /api/v1/pdf/pages/rotate        - Rotar paginas
POST /api/v1/pdf/pages/extract       - Extraer paginas
POST /api/v1/pdf/pages/crop          - Recortar paginas

POST /api/v1/pdf/merge               - Unir PDFs
POST /api/v1/pdf/split               - Dividir PDF
POST /api/v1/pdf/interleave          - Intercalar paginas

POST /api/v1/pdf/edit/text           - Agregar texto
POST /api/v1/pdf/edit/image          - Agregar imagen
POST /api/v1/pdf/edit/watermark      - Agregar marca de agua
POST /api/v1/pdf/edit/header-footer  - Agregar encabezado/pie
POST /api/v1/pdf/edit/page-numbers   - Agregar numeros de pagina

POST /api/v1/pdf/forms/fields        - Listar campos de formulario
POST /api/v1/pdf/forms/fill          - Rellenar formulario
POST /api/v1/pdf/forms/create        - Crear formulario
POST /api/v1/pdf/forms/flatten       - Aplanar formulario

POST /api/v1/pdf/compress            - Comprimir PDF
POST /api/v1/pdf/compress/aggressive - Compresion maxima

POST /api/v1/pdf/security/encrypt    - Encriptar con contrasena
POST /api/v1/pdf/security/decrypt    - Desencriptar
POST /api/v1/pdf/security/sign       - Firmar digitalmente
POST /api/v1/pdf/security/verify     - Verificar firmas
POST /api/v1/pdf/security/redact     - Redactar contenido
POST /api/v1/pdf/security/sanitize   - Sanitizar metadatos

POST /api/v1/pdf/ocr                 - Aplicar OCR
POST /api/v1/pdf/ocr/text            - OCR y extraer solo texto

POST /api/v1/pdf/extract/text        - Extraer texto
POST /api/v1/pdf/extract/images      - Extraer imagenes
POST /api/v1/pdf/extract/tables      - Extraer tablas
POST /api/v1/pdf/extract/metadata    - Extraer metadatos

POST /api/v1/pdf/convert/to-image    - PDF a imagen(es)
POST /api/v1/pdf/convert/from-image  - Imagen(es) a PDF
POST /api/v1/pdf/convert/to-html     - PDF a HTML
POST /api/v1/pdf/convert/from-html   - HTML a PDF
POST /api/v1/pdf/convert/from-url    - URL a PDF
POST /api/v1/pdf/convert/from-office - Office a PDF
POST /api/v1/pdf/convert/to-excel    - PDF a Excel
POST /api/v1/pdf/convert/to-csv      - PDF a CSV
POST /api/v1/pdf/convert/from-ebook  - eBook a PDF
POST /api/v1/pdf/convert/from-md     - Markdown a PDF
POST /api/v1/pdf/convert/to-text     - PDF a texto plano

POST /api/v1/pdf/annotate/highlight  - Agregar resaltados
POST /api/v1/pdf/annotate/lines      - Agregar lineas
POST /api/v1/pdf/annotate/circles    - Agregar circulos
POST /api/v1/pdf/annotate/notes      - Agregar notas adhesivas
POST /api/v1/pdf/annotate/signature  - Agregar firma manuscrita
```

### Configuracion del modulo principal

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PdfPagesModule } from './modules/pdf-pages/pdf-pages.module';
import { PdfMergeModule } from './modules/pdf-merge/pdf-merge.module';
import { PdfEditModule } from './modules/pdf-edit/pdf-edit.module';
import { PdfFormsModule } from './modules/pdf-forms/pdf-forms.module';
import { PdfCompressModule } from './modules/pdf-compress/pdf-compress.module';
import { PdfSecurityModule } from './modules/pdf-security/pdf-security.module';
import { PdfOcrModule } from './modules/pdf-ocr/pdf-ocr.module';
import { PdfExtractModule } from './modules/pdf-extract/pdf-extract.module';
import { PdfConvertModule } from './modules/pdf-convert/pdf-convert.module';
import { PdfAnnotateModule } from './modules/pdf-annotate/pdf-annotate.module';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 100 * 1024 * 1024, // 100 MB
      },
    }),
    PdfPagesModule,
    PdfMergeModule,
    PdfEditModule,
    PdfFormsModule,
    PdfCompressModule,
    PdfSecurityModule,
    PdfOcrModule,
    PdfExtractModule,
    PdfConvertModule,
    PdfAnnotateModule,
  ],
})
export class AppModule {}
```

### Main con Swagger

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS para frontend
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  });

  // Swagger API docs
  const config = new DocumentBuilder()
    .setTitle('PDF Suite API')
    .setDescription('API completa para manipulacion de PDFs')
    .setVersion('1.0')
    .addTag('PDF Pages', 'Manipulacion de paginas')
    .addTag('PDF Merge & Split', 'Union y division')
    .addTag('PDF Edit', 'Edicion de contenido')
    .addTag('PDF Forms', 'Formularios')
    .addTag('PDF Compress', 'Compresion')
    .addTag('PDF Security', 'Seguridad y firmas')
    .addTag('PDF OCR', 'Reconocimiento de texto')
    .addTag('PDF Extract', 'Extraccion de datos')
    .addTag('PDF Convert', 'Conversiones de formato')
    .addTag('PDF Annotate', 'Anotaciones')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3001);
  console.log('PDF Suite API running on http://localhost:3001');
  console.log('Swagger docs: http://localhost:3001/api/docs');
}

bootstrap();
```

---

## 18. Manejo de Archivos Grandes

### Configuracion de Multer con almacenamiento en disco

```typescript
// backend/src/common/config/multer.config.ts
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import * as os from 'os';
import * as path from 'path';

/**
 * Para archivos grandes, usar almacenamiento en disco en lugar de memoria.
 * Multer por defecto usa memoria (buffer), lo cual consume RAM.
 */
export const largePdfMulterConfig: MulterOptions = {
  storage: diskStorage({
    destination: path.join(os.tmpdir(), 'pdf-uploads'),
    filename: (req, file, cb) => {
      const uniqueName = `${uuid()}${extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB para archivos grandes
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/tiff',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/epub+zip',
      'text/html', 'text/markdown', 'text/plain',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`), false);
    }
  },
};
```

### Cola de procesamiento con Bull

```typescript
// backend/src/queue/pdf-queue.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';

@Injectable()
export class PdfQueueService {
  constructor(
    @InjectQueue('pdf-processing') private pdfQueue: Queue
  ) {}

  /**
   * Encolar una operacion PDF pesada.
   * Retorna un job ID para consultar el estado.
   */
  async enqueue(
    operation: string,
    data: Record<string, any>,
    inputFilePath: string
  ): Promise<string> {
    const job = await this.pdfQueue.add(operation, {
      ...data,
      inputFilePath,
      createdAt: new Date().toISOString(),
    }, {
      attempts: 2,
      backoff: 5000,
      removeOnComplete: { age: 3600 }, // Eliminar tras 1 hora
      removeOnFail: { age: 86400 },    // Mantener errores 24h
    });

    return job.id.toString();
  }

  /**
   * Consultar estado de un job.
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: any;
    error?: string;
  }> {
    const job = await this.pdfQueue.getJob(jobId);
    if (!job) return { status: 'not_found', progress: 0 };

    const state = await job.getState();
    return {
      status: state,
      progress: job.progress() as number,
      result: state === 'completed' ? job.returnvalue : undefined,
      error: state === 'failed' ? job.failedReason : undefined,
    };
  }
}
```

### Endpoint de estado de procesamiento

```typescript
// Agregar a cualquier controlador que use colas

@Post('ocr/async')
@ApiOperation({ summary: 'OCR asincrono para archivos grandes' })
@UseInterceptors(FileInterceptor('file', largePdfMulterConfig))
async ocrAsync(
  @UploadedFile() file: Express.Multer.File,
  @Body('language') language: string,
): Promise<{ jobId: string; statusUrl: string }> {
  const jobId = await this.queueService.enqueue('ocr', {
    language: language || 'spa+eng',
  }, file.path);

  return {
    jobId,
    statusUrl: `/api/v1/pdf/jobs/${jobId}`,
  };
}

@Get('jobs/:id')
@ApiOperation({ summary: 'Consultar estado de un job' })
async getJobStatus(@Param('id') jobId: string) {
  return this.queueService.getJobStatus(jobId);
}

@Get('jobs/:id/result')
@ApiOperation({ summary: 'Descargar resultado de un job completado' })
async getJobResult(
  @Param('id') jobId: string,
  @Res({ passthrough: true }) res: Response,
) {
  const status = await this.queueService.getJobStatus(jobId);
  if (status.status !== 'completed') {
    throw new Error('Job no completado');
  }
  // El resultado contiene la ruta al archivo procesado
  const filePath = status.result.outputPath;
  res.set({ 'Content-Type': 'application/pdf' });
  return new StreamableFile(await fs.readFile(filePath));
}
```

---

## 19. Testing

### Tests unitarios del servicio

```typescript
// backend/src/modules/pdf-pages/pdf-pages.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PdfPagesService } from './pdf-pages.service';
import { PDFDocument } from '@cantoo/pdf-lib';

describe('PdfPagesService', () => {
  let service: PdfPagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfPagesService],
    }).compile();
    service = module.get(PdfPagesService);
  });

  // Helper: crear PDF de prueba con N paginas
  async function createTestPdf(numPages: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < numPages; i++) {
      const page = doc.addPage();
      const font = await doc.embedFont('Helvetica');
      page.drawText(`Page ${i + 1}`, { x: 50, y: 500, size: 30, font });
    }
    return Buffer.from(await doc.save());
  }

  describe('removePages', () => {
    it('should remove specified pages', async () => {
      const input = await createTestPdf(5);
      const result = await service.removePages(input, [1, 3]); // eliminar pags 2 y 4
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });

    it('should handle removing all pages except one', async () => {
      const input = await createTestPdf(3);
      const result = await service.removePages(input, [0, 2]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(1);
    });
  });

  describe('reorderPages', () => {
    it('should reorder pages correctly', async () => {
      const input = await createTestPdf(3);
      const result = await service.reorderPages(input, [2, 0, 1]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(3);
    });
  });

  describe('extractPages', () => {
    it('should extract a range of pages', async () => {
      const input = await createTestPdf(10);
      const result = await service.extractPages(input, [
        { start: 0, end: 2 },
        { start: 7, end: 9 },
      ]);
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(6); // 3 + 3
    });
  });
});
```

### Tests E2E del controlador

```typescript
// backend/test/pdf-pages.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PDFDocument } from '@cantoo/pdf-lib';

describe('PDF Pages (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTestPdf(pages: number): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage();
    return Buffer.from(await doc.save());
  }

  it('/api/v1/pdf/pages/remove (POST)', async () => {
    const pdf = await createTestPdf(5);

    const response = await request(app.getHttpServer())
      .post('/api/v1/pdf/pages/remove')
      .attach('file', pdf, 'test.pdf')
      .field('pages', '[0, 2]')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');

    const resultDoc = await PDFDocument.load(response.body);
    expect(resultDoc.getPageCount()).toBe(3);
  });

  it('/api/v1/pdf/merge (POST)', async () => {
    const pdf1 = await createTestPdf(2);
    const pdf2 = await createTestPdf(3);

    const response = await request(app.getHttpServer())
      .post('/api/v1/pdf/merge')
      .attach('files', pdf1, 'doc1.pdf')
      .attach('files', pdf2, 'doc2.pdf')
      .expect(200);

    const resultDoc = await PDFDocument.load(response.body);
    expect(resultDoc.getPageCount()).toBe(5);
  });
});
```

---

## 20. Referencia de Librerias

### Resumen de tecnologias por operacion

| Operacion | Libreria JS/Node | Binario del sistema | Lado |
|-----------|------------------|--------------------|----- |
| Leer/escribir PDF | pdf-lib | - | Ambos |
| Renderizar PDF | PDF.js | - | Frontend |
| Reordenar/eliminar paginas | pdf-lib | - | Ambos |
| Merge/Split | pdf-lib | - | Ambos |
| Agregar texto/imagenes | pdf-lib | - | Ambos |
| Marca de agua | pdf-lib | - | Ambos |
| Formularios | pdf-lib | - | Ambos |
| Compresion basica | pdf-lib | - | Backend |
| Compresion avanzada | - | Ghostscript, QPDF | Backend |
| Encriptacion | - | QPDF | Backend |
| Firmas digitales | node-forge, @signpdf | - | Backend |
| OCR | tesseract.js | Tesseract, OCRmyPDF | Backend |
| Extraer texto | pdf-parse | Poppler (pdftotext) | Backend |
| Extraer imagenes | - | Poppler (pdfimages) | Backend |
| Extraer tablas | - | Tabula (Java) | Backend |
| PDF a imagen | - | Poppler (pdftoppm) | Backend |
| Imagen a PDF | pdf-lib, sharp | - | Backend |
| HTML a PDF | Puppeteer | - | Backend |
| PDF a HTML | - | Poppler (pdftohtml) | Backend |
| Office a PDF | - | LibreOffice | Backend |
| eBook a PDF | - | Calibre | Backend |
| Markdown a PDF | marked + Puppeteer | - | Backend |
| Procesamiento imagenes | sharp | ImageMagick | Backend |
| Verificar firmas | - | Poppler (pdfsig) | Backend |
| Metadatos | pdf-lib, pdf-parse | Poppler (pdfinfo) | Backend |

### Links de documentacion

| Libreria | Documentacion |
|----------|---------------|
| pdf-lib | https://pdf-lib.js.org/ |
| PDF.js | https://mozilla.github.io/pdf.js/ |
| Puppeteer | https://pptr.dev/ |
| sharp | https://sharp.pixelplumbing.com/ |
| tesseract.js | https://tesseract.projectnaptha.com/ |
| node-forge | https://github.com/digitalbazaar/forge |
| pdf-parse | https://gitlab.com/nicholasklick/pdf-parse |
| NestJS | https://docs.nestjs.com/ |
| Next.js | https://nextjs.org/docs |
| @signpdf | https://github.com/vbuch/node-signpdf |
| Ghostscript | https://ghostscript.com/docs/ |
| QPDF | https://qpdf.readthedocs.io/ |
| Poppler | https://poppler.freedesktop.org/ |
| Tesseract | https://tesseract-ocr.github.io/ |
| OCRmyPDF | https://ocrmypdf.readthedocs.io/ |
| LibreOffice | https://api.libreoffice.org/ |
| Calibre | https://manual.calibre-ebook.com/ |

---

## Notas finales

1. **Prioridad de implementacion sugerida**: Empieza por las operaciones que no requieren binarios del sistema (merge, split, reordenar, eliminar, agregar texto, formularios). Estas funcionan solo con `pdf-lib` y se pueden desarrollar y testear sin Docker.

2. **Operaciones en el frontend vs backend**: Todo lo que puedas hacer con `pdf-lib` se puede ejecutar en el navegador. Esto reduce carga del servidor y mejora la experiencia del usuario. Reserva el backend para operaciones que requieren binarios (OCR, compresion Ghostscript, conversiones).

3. **Seguridad**: Siempre validar y sanitizar archivos subidos. Los binarios del sistema (Ghostscript, LibreOffice) historicamente han tenido vulnerabilidades. Ejecutar en containers con permisos limitados.

4. **Escalabilidad**: Para produccion con muchos usuarios concurrentes, usar Redis + Bull para encolar operaciones pesadas. Las conversiones de LibreOffice y el OCR son las operaciones mas lentas y consumen mas recursos.
