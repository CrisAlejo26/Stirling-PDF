# Guía: Editor PDF interactivo con NestJS + Next.js

Implementación inspirada en Stirling PDF para editar PDFs como si fueran documentos de Word.

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────┐
│                    Next.js (Frontend)                │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ PDF Viewer   │  │ Text Editor  │  │ Save/Export│  │
│  │ (pdf.js)     │  │ (contentEdit)│  │ Manager    │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │         │
│  ┌──────┴─────────────────┴────────────────┴──────┐  │
│  │            PdfEditorContext (Estado)            │  │
│  └────────────────────┬───────────────────────────┘  │
└───────────────────────┼─────────────────────────────┘
                        │ REST API (JSON)
┌───────────────────────┼─────────────────────────────┐
│                    NestJS (Backend)                  │
│                                                     │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │ PdfController   │  │ PdfService  │  │ Cache    │  │
│  │ (REST endpoints)│  │ (pdf-lib +  │  │ Manager  │  │
│  │                 │  │  pdf-parse) │  │          │  │
│  └─────────────────┘  └─────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Fase 1: Backend (NestJS)

### 1.1 Dependencias

```bash
npm install pdf-lib pdf-parse @nestjs/cache-manager cache-manager fontkit
```

| Librería | Rol |
|----------|-----|
| `pdf-lib` | Crear/modificar PDFs (reemplazo de Apache PDFBox) |
| `pdf-parse` | Extraer texto con posiciones |
| `fontkit` | Manejo de fonts embebidas |
| `cache-manager` | Cache de documentos para lazy loading |

### 1.2 Modelo de datos (DTOs)

```typescript
// src/pdf-editor/dto/pdf-json.dto.ts

export class TextColor {
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  components: number[]; // [r, g, b] normalizado 0-1
}

export class PdfJsonTextElement {
  text: string;
  fontId: string;
  fontSize: number;
  x: number;          // posición X en puntos PDF (1pt = 1/72 inch)
  y: number;          // posición Y en puntos PDF (origen abajo-izquierda)
  width: number;
  height: number;
  fillColor: TextColor;
  strokeColor?: TextColor;
  characterSpacing?: number;
  wordSpacing?: number;
  // Matriz de transformación 2D [a, b, c, d, e, f]
  // Permite rotación, escala, skew del texto
  textMatrix?: number[];
}

export class PdfJsonImageElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Base64 de la imagen extraída
  data?: string;
  mimeType: 'image/png' | 'image/jpeg';
}

export class PdfJsonFont {
  id: string;
  baseName: string;
  type: 'TrueType' | 'Type1' | 'CFF';
  // Base64 del archivo de font embebida
  data?: string;
  format?: 'ttf' | 'otf' | 'woff2';
  isEmbedded: boolean;
}

export class PdfJsonPage {
  pageNumber: number;
  width: number;       // en puntos PDF
  height: number;
  textElements: PdfJsonTextElement[];
  imageElements: PdfJsonImageElement[];
}

export class PdfJsonDocument {
  totalPages: number;
  fonts: PdfJsonFont[];
  pages: PdfJsonPage[];
  metadata?: {
    title?: string;
    author?: string;
    creator?: string;
  };
}

// Para guardado incremental: solo las páginas modificadas
export class PartialUpdateDto {
  pages: PdfJsonPage[]; // solo dirty pages
}
```

### 1.3 Servicio de extracción

```typescript
// src/pdf-editor/services/pdf-extraction.service.ts

import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib';
import * as pdfParse from 'pdf-parse';
import {
  PdfJsonDocument,
  PdfJsonPage,
  PdfJsonTextElement,
  PdfJsonFont,
  PdfJsonImageElement,
} from '../dto/pdf-json.dto';

@Injectable()
export class PdfExtractionService {

  /**
   * Extrae el documento PDF completo a formato JSON editable.
   *
   * NOTA IMPORTANTE: pdf-parse tiene limitaciones para extraer posiciones
   * exactas de cada carácter. Para producción, considera:
   *
   * Opción A: Usar pdf.js en el backend (via canvas/jsdom)
   *   - npm install pdfjs-dist canvas
   *   - Permite acceder a getTextContent() con posiciones exactas
   *
   * Opción B: Usar un binding nativo como poppler-utils
   *   - pdftotext -bbox genera bounding boxes por palabra
   *   - Más preciso pero requiere binary instalado
   *
   * Opción C: Usar pdf2json
   *   - npm install pdf2json
   *   - Extrae texto con coordenadas x,y por cada "text run"
   *
   * Aquí se muestra Opción A (pdf.js server-side) por ser la más
   * completa y la que usa Stirling PDF.
   */
  async extractDocument(buffer: Buffer): Promise<PdfJsonDocument> {
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();

    const document: PdfJsonDocument = {
      totalPages: pages.length,
      fonts: [],
      pages: [],
      metadata: {
        title: pdfDoc.getTitle() ?? undefined,
        author: pdfDoc.getAuthor() ?? undefined,
      },
    };

    // Extraer fonts embebidas
    document.fonts = this.extractFonts(pdfDoc);

    // Extraer contenido página por página
    for (let i = 0; i < pages.length; i++) {
      document.pages.push(
        await this.extractPage(buffer, pages[i], i, pdfDoc),
      );
    }

    return document;
  }

  /**
   * Extrae solo metadata y dimensiones (para lazy loading).
   * No extrae el contenido de texto — eso se hace página por página.
   */
  async extractMetadata(buffer: Buffer): Promise<{
    totalPages: number;
    fonts: PdfJsonFont[];
    pages: Array<{ pageNumber: number; width: number; height: number }>;
    metadata: Record<string, string>;
  }> {
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();

    return {
      totalPages: pages.length,
      fonts: this.extractFonts(pdfDoc),
      pages: pages.map((page, i) => ({
        pageNumber: i,
        width: page.getWidth(),
        height: page.getHeight(),
      })),
      metadata: {
        title: pdfDoc.getTitle() ?? '',
        author: pdfDoc.getAuthor() ?? '',
      },
    };
  }

  /**
   * Extrae una sola página usando pdf.js server-side.
   *
   * pdf.js es la misma librería que usa el navegador para renderizar PDFs.
   * Al usarla en el servidor, obtenemos las mismas posiciones exactas
   * que se renderizan en el frontend.
   */
  async extractPageContent(
    buffer: Buffer,
    pageNumber: number,
  ): Promise<PdfJsonPage> {
    // Usa pdf.js server-side para extraer texto con posiciones
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber + 1); // pdf.js usa 1-based
    const viewport = page.getViewport({ scale: 1.0 });

    // getTextContent() retorna items con str, transform, width, height
    const textContent = await page.getTextContent();

    const textElements: PdfJsonTextElement[] = textContent.items
      .filter((item: any) => item.str && item.str.trim() !== '')
      .map((item: any, index: number) => {
        // item.transform = [scaleX, skewY, skewX, scaleY, translateX, translateY]
        const [a, b, c, d, tx, ty] = item.transform;

        return {
          text: item.str,
          fontId: item.fontName || `font-${index}`,
          fontSize: Math.sqrt(a * a + b * b), // calcula tamaño real desde la matriz
          x: tx,
          y: viewport.height - ty, // convertir a coordenadas top-left
          width: item.width,
          height: item.height || Math.sqrt(a * a + b * b),
          fillColor: { colorSpace: 'DeviceRGB', components: [0, 0, 0] },
          textMatrix: item.transform,
        };
      });

    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      textElements,
      imageElements: [], // imágenes se extraen por separado
    };
  }

  /**
   * Extrae fonts embebidas del PDF.
   * pdf-lib no expone fonts directamente, así que se usa un approach
   * basado en los objetos internos del PDF.
   */
  private extractFonts(pdfDoc: PDFDocument): PdfJsonFont[] {
    const fonts: PdfJsonFont[] = [];
    // Nota: la extracción completa de fonts embebidas requiere
    // parsear los objetos Font del PDF directamente.
    // Aquí se muestra la estructura; en producción usa fontkit
    // para decodificar los streams de fonts.
    return fonts;
  }

  /**
   * Extrae una página individual con todo su contenido.
   */
  private async extractPage(
    buffer: Buffer,
    page: PDFPage,
    index: number,
    pdfDoc: PDFDocument,
  ): Promise<PdfJsonPage> {
    const content = await this.extractPageContent(buffer, index);
    return {
      ...content,
      width: page.getWidth(),
      height: page.getHeight(),
    };
  }
}
```

### 1.4 Servicio de reconstrucción

```typescript
// src/pdf-editor/services/pdf-reconstruction.service.ts

import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  PdfJsonDocument,
  PdfJsonPage,
  PdfJsonTextElement,
  PartialUpdateDto,
} from '../dto/pdf-json.dto';

@Injectable()
export class PdfReconstructionService {

  /**
   * Convierte un documento JSON completo de vuelta a PDF.
   *
   * Estrategia: Crear nuevo PDF y escribir todo el contenido.
   * Útil para exportación completa.
   */
  async convertJsonToPdf(document: PdfJsonDocument): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Registrar fonts
    const fontMap = await this.registerFonts(pdfDoc, document.fonts);

    // Reconstruir cada página
    for (const pageData of document.pages) {
      await this.reconstructPage(pdfDoc, pageData, fontMap);
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Guardado incremental: modifica solo las páginas que cambiaron.
   *
   * Este es el approach más eficiente y el que da la experiencia
   * fluida al usuario. En lugar de regenerar todo el PDF,
   * solo reescribe las páginas marcadas como "dirty".
   *
   * @param originalPdf Buffer del PDF original (cacheado en servidor)
   * @param updates     Solo las páginas modificadas
   */
  async applyPartialUpdate(
    originalPdf: Buffer,
    updates: PartialUpdateDto,
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(originalPdf);
    pdfDoc.registerFontkit(fontkit);

    for (const pageData of updates.pages) {
      const page = pdfDoc.getPage(pageData.pageNumber);

      // Limpiar contenido existente de la página
      // NOTA: pdf-lib no tiene API directa para limpiar content streams.
      // Approach: eliminar la página y recrearla en la misma posición.
      const { width, height } = page.getSize();
      pdfDoc.removePage(pageData.pageNumber);
      const newPage = pdfDoc.insertPage(pageData.pageNumber, [width, height]);

      // Registrar fonts necesarias para esta página
      const fontMap = await this.registerFonts(pdfDoc, []);

      // Escribir el contenido editado
      await this.writeTextElements(newPage, pageData.textElements, fontMap);
      await this.writeImageElements(pdfDoc, newPage, pageData.imageElements);
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Reconstruye una página completa desde su representación JSON.
   */
  private async reconstructPage(
    pdfDoc: PDFDocument,
    pageData: PdfJsonPage,
    fontMap: Map<string, PDFFont>,
  ): Promise<void> {
    const page = pdfDoc.addPage([pageData.width, pageData.height]);
    await this.writeTextElements(page, pageData.textElements, fontMap);
    await this.writeImageElements(pdfDoc, page, pageData.imageElements);
  }

  /**
   * Escribe elementos de texto en una página PDF.
   *
   * Cada textElement tiene posición exacta (x, y), font, tamaño y color.
   * Se usa page.drawText() de pdf-lib para posicionar cada fragmento.
   */
  private async writeTextElements(
    page: PDFPage,
    elements: PdfJsonTextElement[],
    fontMap: Map<string, PDFFont>,
  ): Promise<void> {
    for (const el of elements) {
      const font = fontMap.get(el.fontId);
      // Fallback a Helvetica si no se encuentra la font
      const drawFont = font ?? fontMap.get('__default__');
      if (!drawFont) continue;

      const color = el.fillColor?.components ?? [0, 0, 0];

      page.drawText(el.text, {
        x: el.x,
        // pdf-lib usa coordenadas bottom-left, igual que PDF nativo
        y: page.getHeight() - el.y - el.height,
        size: el.fontSize,
        font: drawFont,
        color: rgb(color[0], color[1], color[2]),
      });
    }
  }

  /**
   * Escribe imágenes en una página PDF.
   */
  private async writeImageElements(
    pdfDoc: PDFDocument,
    page: PDFPage,
    elements: any[],
  ): Promise<void> {
    if (!elements) return;

    for (const img of elements) {
      if (!img.data) continue;

      const imageBytes = Buffer.from(img.data, 'base64');
      const pdfImage = img.mimeType === 'image/png'
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);

      page.drawImage(pdfImage, {
        x: img.x,
        y: page.getHeight() - img.y - img.height,
        width: img.width,
        height: img.height,
      });
    }
  }

  /**
   * Registra fonts en el documento PDF.
   *
   * Para fonts embebidas: decodifica el base64 y las embebe.
   * Siempre incluye una font por defecto como fallback.
   */
  private async registerFonts(
    pdfDoc: PDFDocument,
    fonts: any[],
  ): Promise<Map<string, PDFFont>> {
    const fontMap = new Map<string, PDFFont>();

    // Font por defecto (siempre disponible)
    const defaultFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    fontMap.set('__default__', defaultFont);

    // Registrar fonts embebidas del documento original
    for (const fontData of fonts) {
      if (fontData.data) {
        try {
          const fontBytes = Buffer.from(fontData.data, 'base64');
          const embeddedFont = await pdfDoc.embedFont(fontBytes);
          fontMap.set(fontData.id, embeddedFont);
        } catch {
          // Si falla la font embebida, usa fallback
          fontMap.set(fontData.id, defaultFont);
        }
      }
    }

    return fontMap;
  }
}
```

### 1.5 Cache Manager

```typescript
// src/pdf-editor/services/pdf-cache.service.ts

import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

interface CachedDocument {
  buffer: Buffer;
  createdAt: Date;
  lastAccess: Date;
}

/**
 * Cache de PDFs originales en memoria del servidor.
 *
 * Cuando el usuario abre un PDF para editar:
 * 1. Se sube el PDF una sola vez
 * 2. Se genera un jobId único
 * 3. El PDF se cachea asociado a ese jobId
 * 4. Las peticiones posteriores (lazy page load, guardar) usan el jobId
 *
 * Esto evita re-subir el PDF completo en cada operación.
 * Stirling PDF usa exactamente este patrón.
 */
@Injectable()
export class PdfCacheService {
  // En producción usar Redis o similar
  private cache = new Map<string, CachedDocument>();
  private readonly MAX_CACHE_SIZE = 50;
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutos

  /**
   * Almacena un PDF y retorna un jobId para referenciarlo.
   */
  store(buffer: Buffer): string {
    this.evictExpired();

    const jobId = uuidv4();
    this.cache.set(jobId, {
      buffer,
      createdAt: new Date(),
      lastAccess: new Date(),
    });
    return jobId;
  }

  /**
   * Recupera el PDF original por jobId.
   */
  get(jobId: string): Buffer | null {
    const entry = this.cache.get(jobId);
    if (!entry) return null;
    entry.lastAccess = new Date();
    return entry.buffer;
  }

  /**
   * Reemplaza el PDF cacheado (después de un guardado parcial).
   */
  update(jobId: string, buffer: Buffer): void {
    const entry = this.cache.get(jobId);
    if (entry) {
      entry.buffer = buffer;
      entry.lastAccess = new Date();
    }
  }

  /**
   * Elimina el cache cuando el usuario termina de editar.
   */
  clear(jobId: string): void {
    this.cache.delete(jobId);
  }

  /**
   * LRU eviction: elimina entradas expiradas o las más antiguas
   * si se excede el tamaño máximo.
   */
  private evictExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache) {
      if (now - entry.lastAccess.getTime() > this.TTL_MS) {
        this.cache.delete(key);
      }
    }

    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Eliminar la entrada con acceso más antiguo
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.lastAccess.getTime() < oldestTime) {
          oldestTime = entry.lastAccess.getTime();
          oldestKey = key;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }
}
```

### 1.6 Controller

```typescript
// src/pdf-editor/pdf-editor.controller.ts

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { PdfExtractionService } from './services/pdf-extraction.service';
import { PdfReconstructionService } from './services/pdf-reconstruction.service';
import { PdfCacheService } from './services/pdf-cache.service';
import { PdfJsonDocument, PartialUpdateDto } from './dto/pdf-json.dto';

@Controller('api/v1/pdf-editor')
export class PdfEditorController {
  constructor(
    private readonly extractionService: PdfExtractionService,
    private readonly reconstructionService: PdfReconstructionService,
    private readonly cacheService: PdfCacheService,
  ) {}

  /**
   * POST /api/v1/pdf-editor/open
   *
   * Paso 1: El usuario sube un PDF para editar.
   * - Extrae metadata y dimensiones de páginas
   * - Cachea el PDF original en el servidor
   * - Retorna jobId + metadata (sin contenido de páginas)
   *
   * El contenido de cada página se carga lazy via /page/:jobId/:pageNumber
   */
  @Post('open')
  @UseInterceptors(FileInterceptor('file'))
  async openDocument(@UploadedFile() file: Express.Multer.File) {
    const buffer = file.buffer;
    const jobId = this.cacheService.store(buffer);
    const metadata = await this.extractionService.extractMetadata(buffer);

    return {
      jobId,
      ...metadata,
    };
  }

  /**
   * GET /api/v1/pdf-editor/page/:jobId/:pageNumber
   *
   * Paso 2: Carga lazy de una página individual.
   * Solo se llama cuando el usuario navega a esa página.
   * Retorna todos los textElements con posiciones exactas.
   */
  @Get('page/:jobId/:pageNumber')
  async getPage(
    @Param('jobId') jobId: string,
    @Param('pageNumber') pageNumber: number,
  ) {
    const buffer = this.cacheService.get(jobId);
    if (!buffer) {
      throw new HttpException('Document not found in cache', HttpStatus.NOT_FOUND);
    }

    return this.extractionService.extractPageContent(buffer, Number(pageNumber));
  }

  /**
   * GET /api/v1/pdf-editor/fonts/:jobId/:pageNumber
   *
   * Carga las fonts usadas en una página específica.
   * El frontend las registra como @font-face para renderizar
   * el texto con la misma tipografía del PDF original.
   */
  @Get('fonts/:jobId/:pageNumber')
  async getPageFonts(
    @Param('jobId') jobId: string,
    @Param('pageNumber') pageNumber: number,
  ) {
    // Extraer fonts específicas de la página
    // En implementación completa, parsear el PDF y extraer font programs
    return { fonts: [] };
  }

  /**
   * POST /api/v1/pdf-editor/save/:jobId
   *
   * Guardado incremental: solo procesa las páginas modificadas.
   * - Recibe PartialUpdateDto con solo las dirty pages
   * - Aplica cambios sobre el PDF original cacheado
   * - Retorna el nuevo PDF
   * - Actualiza el cache con el PDF modificado
   */
  @Post('save/:jobId')
  async savePartial(
    @Param('jobId') jobId: string,
    @Body() updates: PartialUpdateDto,
    @Res() res: Response,
  ) {
    const originalBuffer = this.cacheService.get(jobId);
    if (!originalBuffer) {
      throw new HttpException('Document not found in cache', HttpStatus.NOT_FOUND);
    }

    const updatedPdf = await this.reconstructionService.applyPartialUpdate(
      originalBuffer,
      updates,
    );

    // Actualizar cache con la versión modificada
    this.cacheService.update(jobId, updatedPdf);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="edited.pdf"',
    });
    res.send(updatedPdf);
  }

  /**
   * POST /api/v1/pdf-editor/export
   *
   * Exportación completa: convierte todo el JSON de vuelta a PDF.
   * Útil cuando se quiere generar un PDF desde cero con todos los cambios.
   */
  @Post('export')
  async exportFull(
    @Body() document: PdfJsonDocument,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.reconstructionService.convertJsonToPdf(document);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="exported.pdf"',
    });
    res.send(pdfBuffer);
  }

  /**
   * POST /api/v1/pdf-editor/close/:jobId
   *
   * Limpia el cache cuando el usuario termina de editar.
   * Importante para liberar memoria del servidor.
   */
  @Post('close/:jobId')
  async closeDocument(@Param('jobId') jobId: string) {
    this.cacheService.clear(jobId);
    return { success: true };
  }
}
```

### 1.7 Módulo NestJS

```typescript
// src/pdf-editor/pdf-editor.module.ts

import { Module } from '@nestjs/common';
import { PdfEditorController } from './pdf-editor.controller';
import { PdfExtractionService } from './services/pdf-extraction.service';
import { PdfReconstructionService } from './services/pdf-reconstruction.service';
import { PdfCacheService } from './services/pdf-cache.service';

@Module({
  controllers: [PdfEditorController],
  providers: [
    PdfExtractionService,
    PdfReconstructionService,
    PdfCacheService,
  ],
})
export class PdfEditorModule {}
```

---

## Fase 2: Frontend (Next.js)

### 2.1 Dependencias

```bash
npm install pdfjs-dist react-rnd axios
```

| Librería | Rol |
|----------|-----|
| `pdfjs-dist` | Renderizar PDFs en canvas + text layer |
| `react-rnd` | Drag & resize de bloques de texto |
| `axios` | HTTP client |

### 2.2 Tipos compartidos

```typescript
// src/types/pdf-editor.ts

export interface TextColor {
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  components: number[];
}

export interface PdfJsonTextElement {
  text: string;
  fontId: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: TextColor;
  textMatrix?: number[];
}

export interface PdfJsonImageElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data?: string;
  mimeType: string;
}

export interface PdfJsonPage {
  pageNumber: number;
  width: number;
  height: number;
  textElements: PdfJsonTextElement[];
  imageElements: PdfJsonImageElement[];
}

export interface PdfJsonFont {
  id: string;
  baseName: string;
  data?: string;
  format?: string;
}

/**
 * TextGroup: agrupación de textElements consecutivos en líneas o párrafos.
 *
 * Los PDFs almacenan texto como fragmentos individuales (a veces por carácter).
 * Para editarlos como texto continuo, se agrupan en líneas/párrafos basándose
 * en su proximidad espacial.
 */
export interface TextGroup {
  id: string;
  pageIndex: number;
  text: string;             // texto concatenado del grupo
  elements: PdfJsonTextElement[]; // elementos originales
  x: number;                // bounding box del grupo
  y: number;
  width: number;
  height: number;
  fontSize: number;         // tamaño predominante
  fontId: string;
  fontFamily: string;       // CSS font-family
  color: string;            // CSS color
  isModified: boolean;
}

export interface EditorState {
  jobId: string | null;
  totalPages: number;
  currentPage: number;
  pages: Map<number, PdfJsonPage>;      // páginas cargadas
  groups: Map<number, TextGroup[]>;     // grupos por página
  dirtyPages: Set<number>;              // páginas modificadas
  isLoading: boolean;
  scale: number;
}
```

### 2.3 Servicio API

```typescript
// src/services/pdf-editor-api.ts

import axios from 'axios';
import type { PdfJsonPage, PdfJsonFont } from '@/types/pdf-editor';

const API_BASE = '/api/v1/pdf-editor';

export const pdfEditorApi = {
  /**
   * Sube el PDF y obtiene jobId + metadata.
   */
  async openDocument(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await axios.post(`${API_BASE}/open`, formData);
    return data as {
      jobId: string;
      totalPages: number;
      fonts: PdfJsonFont[];
      pages: Array<{ pageNumber: number; width: number; height: number }>;
    };
  },

  /**
   * Carga lazy de una página.
   */
  async getPage(jobId: string, pageNumber: number): Promise<PdfJsonPage> {
    const { data } = await axios.get(`${API_BASE}/page/${jobId}/${pageNumber}`);
    return data;
  },

  /**
   * Carga fonts de una página.
   */
  async getPageFonts(jobId: string, pageNumber: number): Promise<PdfJsonFont[]> {
    const { data } = await axios.get(`${API_BASE}/fonts/${jobId}/${pageNumber}`);
    return data.fonts;
  },

  /**
   * Guardado incremental.
   */
  async savePartial(
    jobId: string,
    dirtyPages: PdfJsonPage[],
  ): Promise<Blob> {
    const { data } = await axios.post(
      `${API_BASE}/save/${jobId}`,
      { pages: dirtyPages },
      { responseType: 'blob' },
    );
    return data;
  },

  /**
   * Cierra el documento y libera cache del servidor.
   */
  async closeDocument(jobId: string): Promise<void> {
    await axios.post(`${API_BASE}/close/${jobId}`);
  },
};
```

### 2.4 Utilidad de agrupación de texto

```typescript
// src/utils/text-grouping.ts

import type { PdfJsonTextElement, TextGroup } from '@/types/pdf-editor';

/**
 * Agrupa elementos de texto individuales en líneas o párrafos editables.
 *
 * Los PDFs guardan texto como fragmentos separados (a veces cada palabra,
 * a veces cada carácter). Para que el usuario pueda editar texto de forma
 * natural, agrupamos los fragmentos que están en la misma línea o párrafo.
 *
 * Algoritmo:
 * 1. Ordenar por posición Y (línea), luego X (posición en línea)
 * 2. Si dos elementos están en el mismo rango Y (±tolerancia), están en la misma línea
 * 3. Líneas consecutivas con poco espacio entre ellas forman un párrafo
 */
export function groupTextElements(
  elements: PdfJsonTextElement[],
  pageIndex: number,
  mode: 'line' | 'paragraph' = 'paragraph',
): TextGroup[] {
  if (elements.length === 0) return [];

  // Ordenar: primero por Y (arriba a abajo), luego por X (izq a der)
  const sorted = [...elements].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 2) return yDiff; // tolerancia de 2pt para misma línea
    return a.x - b.x;
  });

  // Paso 1: Agrupar en líneas
  const lines: PdfJsonTextElement[][] = [];
  let currentLine: PdfJsonTextElement[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // Si la diferencia en Y es menor que la altura del texto, misma línea
    const lineThreshold = Math.max(prev.height, curr.height) * 0.5;
    if (Math.abs(curr.y - prev.y) <= lineThreshold) {
      currentLine.push(curr);
    } else {
      lines.push(currentLine);
      currentLine = [curr];
    }
  }
  lines.push(currentLine);

  if (mode === 'line') {
    return lines.map((line, i) => lineToGroup(line, pageIndex, i));
  }

  // Paso 2: Agrupar líneas en párrafos
  const paragraphs: PdfJsonTextElement[][] = [];
  let currentParagraph: PdfJsonTextElement[] = [...lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i - 1];
    const currLine = lines[i];
    const prevBottom = Math.max(...prevLine.map((e) => e.y + e.height));
    const currTop = Math.min(...currLine.map((e) => e.y));
    const gap = currTop - prevBottom;
    const avgFontSize = prevLine[0].fontSize;

    // Si el gap entre líneas es menor que 1.5x el tamaño de fuente, mismo párrafo
    if (gap < avgFontSize * 1.5) {
      currentParagraph.push(...currLine);
    } else {
      paragraphs.push(currentParagraph);
      currentParagraph = [...currLine];
    }
  }
  paragraphs.push(currentParagraph);

  return paragraphs.map((para, i) => lineToGroup(para, pageIndex, i));
}

/**
 * Convierte un array de textElements en un TextGroup con bounding box calculado.
 */
function lineToGroup(
  elements: PdfJsonTextElement[],
  pageIndex: number,
  index: number,
): TextGroup {
  const text = elements.map((e) => e.text).join('');
  const x = Math.min(...elements.map((e) => e.x));
  const y = Math.min(...elements.map((e) => e.y));
  const maxX = Math.max(...elements.map((e) => e.x + e.width));
  const maxY = Math.max(...elements.map((e) => e.y + e.height));

  // Color CSS del primer elemento
  const fc = elements[0].fillColor?.components ?? [0, 0, 0];
  const color = `rgb(${Math.round(fc[0] * 255)}, ${Math.round(fc[1] * 255)}, ${Math.round(fc[2] * 255)})`;

  return {
    id: `group-${pageIndex}-${index}`,
    pageIndex,
    text,
    elements,
    x,
    y,
    width: maxX - x,
    height: maxY - y,
    fontSize: elements[0].fontSize,
    fontId: elements[0].fontId,
    fontFamily: `pdf-font-${elements[0].fontId}, Helvetica, Arial, sans-serif`,
    color,
    isModified: false,
  };
}
```

### 2.5 Hook del editor

```typescript
// src/hooks/usePdfEditor.ts

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  PdfJsonPage,
  PdfJsonFont,
  TextGroup,
  EditorState,
} from '@/types/pdf-editor';
import { pdfEditorApi } from '@/services/pdf-editor-api';
import { groupTextElements } from '@/utils/text-grouping';

/**
 * Hook principal que orquesta todo el estado del editor PDF.
 *
 * Responsabilidades:
 * - Subida y apertura del documento
 * - Lazy loading de páginas
 * - Tracking de cambios (dirty pages)
 * - Guardado incremental
 * - Limpieza al cerrar
 */
export function usePdfEditor() {
  const [state, setState] = useState<EditorState>({
    jobId: null,
    totalPages: 0,
    currentPage: 0,
    pages: new Map(),
    groups: new Map(),
    dirtyPages: new Set(),
    isLoading: false,
    scale: 1.0,
  });

  const [fonts, setFonts] = useState<PdfJsonFont[]>([]);
  const [pageDimensions, setPageDimensions] = useState<
    Array<{ width: number; height: number }>
  >([]);

  // Ref para acceder al estado actual en callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Abre un documento PDF para editar.
   */
  const openDocument = useCallback(async (file: File) => {
    setState((s) => ({ ...s, isLoading: true }));

    try {
      const result = await pdfEditorApi.openDocument(file);

      setFonts(result.fonts);
      setPageDimensions(result.pages);

      setState((s) => ({
        ...s,
        jobId: result.jobId,
        totalPages: result.totalPages,
        currentPage: 0,
        pages: new Map(),
        groups: new Map(),
        dirtyPages: new Set(),
        isLoading: false,
      }));

      // Registrar fonts como @font-face en el DOM
      registerFonts(result.fonts);
    } catch (error) {
      setState((s) => ({ ...s, isLoading: false }));
      throw error;
    }
  }, []);

  /**
   * Carga lazy de una página (si no está ya cargada).
   */
  const loadPage = useCallback(
    async (pageNumber: number) => {
      const { jobId, pages } = stateRef.current;
      if (!jobId || pages.has(pageNumber)) return;

      setState((s) => ({ ...s, isLoading: true }));

      const pageData = await pdfEditorApi.getPage(jobId, pageNumber);
      const groups = groupTextElements(
        pageData.textElements,
        pageNumber,
        'paragraph',
      );

      setState((s) => {
        const newPages = new Map(s.pages);
        newPages.set(pageNumber, pageData);
        const newGroups = new Map(s.groups);
        newGroups.set(pageNumber, groups);
        return { ...s, pages: newPages, groups: newGroups, isLoading: false };
      });
    },
    [],
  );

  /**
   * Navega a una página y la carga si es necesario.
   */
  const goToPage = useCallback(
    async (pageNumber: number) => {
      setState((s) => ({ ...s, currentPage: pageNumber }));
      await loadPage(pageNumber);
    },
    [loadPage],
  );

  /**
   * Actualiza el texto de un grupo (cuando el usuario edita).
   *
   * Esta función se llama desde el onInput del contentEditable.
   * Marca la página como "dirty" para el guardado incremental.
   */
  const updateGroupText = useCallback(
    (pageIndex: number, groupId: string, newText: string) => {
      setState((s) => {
        const pageGroups = s.groups.get(pageIndex);
        if (!pageGroups) return s;

        const updatedGroups = pageGroups.map((group) =>
          group.id === groupId
            ? { ...group, text: newText, isModified: true }
            : group,
        );

        const newGroups = new Map(s.groups);
        newGroups.set(pageIndex, updatedGroups);

        const newDirty = new Set(s.dirtyPages);
        newDirty.add(pageIndex);

        return { ...s, groups: newGroups, dirtyPages: newDirty };
      });
    },
    [],
  );

  /**
   * Actualiza la posición de un grupo (cuando el usuario lo arrastra).
   */
  const updateGroupPosition = useCallback(
    (pageIndex: number, groupId: string, x: number, y: number) => {
      setState((s) => {
        const pageGroups = s.groups.get(pageIndex);
        if (!pageGroups) return s;

        const updatedGroups = pageGroups.map((group) =>
          group.id === groupId
            ? { ...group, x, y, isModified: true }
            : group,
        );

        const newGroups = new Map(s.groups);
        newGroups.set(pageIndex, updatedGroups);

        const newDirty = new Set(s.dirtyPages);
        newDirty.add(pageIndex);

        return { ...s, groups: newGroups, dirtyPages: newDirty };
      });
    },
    [],
  );

  /**
   * Guardado incremental: solo envía las páginas modificadas.
   */
  const save = useCallback(async () => {
    const { jobId, dirtyPages, groups, pages } = stateRef.current;
    if (!jobId || dirtyPages.size === 0) return null;

    // Construir payload solo con dirty pages
    const dirtyPagesData: PdfJsonPage[] = [];

    for (const pageIndex of dirtyPages) {
      const pageData = pages.get(pageIndex);
      const pageGroups = groups.get(pageIndex);
      if (!pageData || !pageGroups) continue;

      // Reconstruir textElements desde los grupos editados
      const textElements = pageGroups.flatMap((group) => {
        if (!group.isModified) return group.elements;

        // Si el texto cambió, crear un nuevo textElement con el texto editado
        return [
          {
            text: group.text,
            fontId: group.fontId,
            fontSize: group.fontSize,
            x: group.x,
            y: group.y,
            width: group.width,
            height: group.height,
            fillColor: group.elements[0]?.fillColor ?? {
              colorSpace: 'DeviceRGB' as const,
              components: [0, 0, 0],
            },
          },
        ];
      });

      dirtyPagesData.push({
        ...pageData,
        textElements,
      });
    }

    const blob = await pdfEditorApi.savePartial(jobId, dirtyPagesData);

    // Limpiar dirty pages
    setState((s) => ({ ...s, dirtyPages: new Set() }));

    return blob;
  }, []);

  /**
   * Cierra el documento y libera recursos.
   */
  const closeDocument = useCallback(async () => {
    const { jobId } = stateRef.current;
    if (jobId) {
      await pdfEditorApi.closeDocument(jobId);
    }
    setState({
      jobId: null,
      totalPages: 0,
      currentPage: 0,
      pages: new Map(),
      groups: new Map(),
      dirtyPages: new Set(),
      isLoading: false,
      scale: 1.0,
    });
  }, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      const { jobId } = stateRef.current;
      if (jobId) {
        pdfEditorApi.closeDocument(jobId).catch(() => {});
      }
    };
  }, []);

  return {
    state,
    fonts,
    pageDimensions,
    openDocument,
    loadPage,
    goToPage,
    updateGroupText,
    updateGroupPosition,
    save,
    closeDocument,
    setScale: (scale: number) => setState((s) => ({ ...s, scale })),
  };
}

/**
 * Registra fonts del PDF como @font-face en el DOM.
 *
 * Cada font embebida en el PDF se convierte en una regla CSS
 * para que el texto se renderice con la tipografía original.
 */
function registerFonts(fonts: PdfJsonFont[]): void {
  // Eliminar fonts anteriores
  const existingStyle = document.getElementById('pdf-editor-fonts');
  if (existingStyle) existingStyle.remove();

  const style = document.createElement('style');
  style.id = 'pdf-editor-fonts';

  let css = '';
  for (const font of fonts) {
    if (!font.data) continue;

    const format = font.format === 'otf' ? 'opentype' : font.format ?? 'truetype';
    css += `
      @font-face {
        font-family: 'pdf-font-${font.id}';
        src: url(data:font/${format};base64,${font.data}) format('${format}');
        font-display: swap;
      }
    `;
  }

  style.textContent = css;
  document.head.appendChild(style);
}
```

### 2.6 Utilidades de cursor (caret)

```typescript
// src/utils/caret.ts

/**
 * Obtiene la posición del cursor dentro de un elemento contentEditable.
 *
 * Esto es crítico para la experiencia de edición: cuando el usuario
 * escribe y React re-renderiza el contentEditable, el cursor se pierde.
 * Guardamos la posición antes del re-render y la restauramos después.
 */
export function getCaretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return element.innerText.length;
  }

  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.focusNode as Node, selection.focusOffset);
  return range.toString().length;
}

/**
 * Restaura el cursor a una posición específica.
 *
 * Usa TreeWalker para navegar los nodos de texto internos
 * y posicionar el cursor en el offset exacto.
 */
export function setCaretOffset(element: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let currentOffset = 0;
  let node: Text | null = null;

  while (walker.nextNode()) {
    node = walker.currentNode as Text;
    const nodeLength = node.textContent?.length ?? 0;

    if (currentOffset + nodeLength >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - currentOffset);
      range.collapse(true);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    currentOffset += nodeLength;
  }

  // Si el offset excede el contenido, poner cursor al final
  if (node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

/**
 * Posiciona el cursor en el punto exacto donde el usuario hizo click.
 *
 * Usa caretRangeFromPoint (Chrome/Safari) o caretPositionFromPoint (Firefox)
 * para determinar la posición exacta del carácter bajo el cursor del mouse.
 */
export function placeCaretAtPoint(x: number, y: number): void {
  let range: Range | null = null;

  if (document.caretRangeFromPoint) {
    // Chrome, Safari
    range = document.caretRangeFromPoint(x, y);
  } else if ((document as any).caretPositionFromPoint) {
    // Firefox
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }

  if (range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}
```

### 2.7 Componente de bloque de texto editable

```tsx
// src/components/pdf-editor/EditableTextBlock.tsx

'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { TextGroup } from '@/types/pdf-editor';
import { getCaretOffset, setCaretOffset, placeCaretAtPoint } from '@/utils/caret';

interface Props {
  group: TextGroup;
  scale: number;
  pageHeight: number;
  isActive: boolean;
  onActivate: (groupId: string) => void;
  onTextChange: (groupId: string, newText: string) => void;
  onPositionChange: (groupId: string, x: number, y: number) => void;
}

/**
 * Bloque de texto editable individual.
 *
 * Cada TextGroup del PDF se renderiza como uno de estos componentes.
 * Usa react-rnd para drag/resize y contentEditable para edición de texto.
 *
 * Visual states:
 * - Default: invisible (el texto parece ser parte del PDF)
 * - Hover: borde sutil
 * - Active/editing: borde azul + fondo semitransparente
 * - Modified: borde amarillo (indica cambios sin guardar)
 */
export function EditableTextBlock({
  group,
  scale,
  pageHeight,
  isActive,
  onActivate,
  onTextChange,
  onPositionChange,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const caretOffsetRef = useRef<number>(0);
  const [isHovered, setIsHovered] = useState(false);

  // Restaurar caret después de re-render por cambio de texto
  useEffect(() => {
    if (isActive && editorRef.current) {
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          setCaretOffset(editorRef.current, caretOffsetRef.current);
        }
      });
    }
  }, [group.text, isActive]);

  /**
   * Sincroniza el texto editado con el estado del editor.
   *
   * Se ejecuta en cada onInput (cada tecla presionada).
   * Guarda la posición del caret antes de actualizar el estado
   * para poder restaurarla después del re-render de React.
   */
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // Guardar posición del caret ANTES de que React re-renderice
    caretOffsetRef.current = getCaretOffset(el);

    // Notificar cambio de texto
    const newText = el.innerText;
    onTextChange(group.id, newText);
  }, [group.id, onTextChange]);

  /**
   * Al hacer click, activar el grupo y posicionar el caret
   * exactamente donde el usuario hizo click.
   */
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate(group.id);

      // Posicionar caret en el punto del click
      requestAnimationFrame(() => {
        placeCaretAtPoint(e.clientX, e.clientY);
      });
    },
    [group.id, onActivate],
  );

  // Determinar estilo del borde según estado
  const getBorderStyle = () => {
    if (isActive) return '2px solid #3b82f6';         // azul cuando se edita
    if (group.isModified) return '1px solid #eab308';  // amarillo si modificado
    if (isHovered) return '1px dashed #94a3b8';        // punteado en hover
    return '1px solid transparent';                     // invisible por defecto
  };

  const getBackgroundColor = () => {
    if (isActive) return 'rgba(59, 130, 246, 0.08)';
    if (group.isModified) return 'rgba(234, 179, 8, 0.06)';
    return 'transparent';
  };

  return (
    <Rnd
      position={{
        x: group.x * scale,
        y: group.y * scale,
      }}
      size={{
        width: group.width * scale,
        height: group.height * scale,
      }}
      onDragStop={(_e, d) => {
        // Convertir de vuelta a coordenadas PDF
        onPositionChange(group.id, d.x / scale, d.y / scale);
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        onPositionChange(group.id, position.x / scale, position.y / scale);
      }}
      // Solo permitir drag/resize cuando está activo
      disableDragging={!isActive}
      enableResizing={isActive}
      bounds="parent"
      style={{ zIndex: isActive ? 10 : 1 }}
    >
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: '100%',
          height: '100%',
          border: getBorderStyle(),
          backgroundColor: getBackgroundColor(),
          borderRadius: '4px',
          transition: 'border 120ms ease, background-color 120ms ease',
          cursor: isActive ? 'text' : 'pointer',
        }}
      >
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onClick={handleClick}
          onInput={handleInput}
          onBlur={() => {
            // Guardar en blur también (por si onInput no se disparó)
            if (editorRef.current) {
              onTextChange(group.id, editorRef.current.innerText);
            }
          }}
          // Soporte para IME (idiomas CJK, acentos, etc.)
          onCompositionEnd={() => {
            if (editorRef.current) {
              onTextChange(group.id, editorRef.current.innerText);
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            padding: '2px',
            outline: 'none',
            fontSize: `${group.fontSize * scale}px`,
            fontFamily: group.fontFamily,
            color: group.color,
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // Importante: sin overflow hidden para que el texto
            // pueda expandirse si el usuario escribe más
            overflow: 'visible',
          }}
          dangerouslySetInnerHTML={{ __html: group.text || '&nbsp;' }}
        />
      </div>
    </Rnd>
  );
}
```

### 2.8 Componente de página PDF

```tsx
// src/components/pdf-editor/PdfEditorPage.tsx

'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { TextGroup } from '@/types/pdf-editor';
import { EditableTextBlock } from './EditableTextBlock';

interface Props {
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  groups: TextGroup[];
  pdfBuffer: ArrayBuffer | null; // PDF original para renderizar como fondo
  onTextChange: (pageIndex: number, groupId: string, newText: string) => void;
  onPositionChange: (pageIndex: number, groupId: string, x: number, y: number) => void;
}

/**
 * Renderiza una página del PDF con sus bloques de texto editables superpuestos.
 *
 * Arquitectura de capas (de abajo a arriba):
 * 1. Canvas: renderizado visual del PDF original (pdf.js)
 * 2. Capa de texto editable: divs contentEditable posicionados sobre el canvas
 *
 * El canvas muestra el PDF como imagen de fondo (vectores, imágenes, fondos).
 * Los bloques de texto editables se superponen exactamente sobre el texto
 * renderizado en el canvas, creando la ilusión de edición directa.
 */
export function PdfEditorPage({
  pageNumber,
  width,
  height,
  scale,
  groups,
  pdfBuffer,
  onTextChange,
  onPositionChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  /**
   * Renderiza el PDF en el canvas usando pdf.js.
   *
   * Esto genera la capa visual base: todo lo que no es texto editable
   * (imágenes, vectores, fondos, bordes, etc.) se ve aquí.
   */
  useEffect(() => {
    if (!pdfBuffer || !canvasRef.current) return;

    let cancelled = false;

    async function renderPage() {
      const pdfjsLib = await import('pdfjs-dist');
      // Configurar worker de pdf.js
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      const pdf = await pdfjsLib.getDocument({ data: pdfBuffer! }).promise;
      const page = await pdf.getPage(pageNumber + 1);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (!cancelled) {
        await page.render({ canvasContext: context, viewport }).promise;
      }

      pdf.destroy();
    }

    renderPage();
    return () => { cancelled = true; };
  }, [pdfBuffer, pageNumber, scale]);

  // Deseleccionar grupo al hacer click fuera de cualquier bloque
  const handleBackgroundClick = useCallback(() => {
    setActiveGroupId(null);
  }, []);

  return (
    <div
      onClick={handleBackgroundClick}
      style={{
        position: 'relative',
        width: width * scale,
        height: height * scale,
        margin: '16px auto',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        backgroundColor: 'white',
      }}
    >
      {/* Capa 1: Canvas con el render visual del PDF */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Capa 2: Bloques de texto editables superpuestos */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      >
        {groups.map((group) => (
          <EditableTextBlock
            key={group.id}
            group={group}
            scale={scale}
            pageHeight={height}
            isActive={activeGroupId === group.id}
            onActivate={setActiveGroupId}
            onTextChange={(groupId, text) =>
              onTextChange(pageNumber, groupId, text)
            }
            onPositionChange={(groupId, x, y) =>
              onPositionChange(pageNumber, groupId, x, y)
            }
          />
        ))}
      </div>
    </div>
  );
}
```

### 2.9 Componente principal del editor

```tsx
// src/components/pdf-editor/PdfEditor.tsx

'use client';

import React, { useCallback, useRef, useState } from 'react';
import { usePdfEditor } from '@/hooks/usePdfEditor';
import { PdfEditorPage } from './PdfEditorPage';

/**
 * Componente raíz del editor PDF.
 *
 * Compone todos los sub-componentes y maneja:
 * - Upload del PDF
 * - Toolbar (zoom, guardar, navegar páginas)
 * - Renderizado de páginas con lazy loading
 * - Descarga del PDF editado
 */
export function PdfEditor() {
  const {
    state,
    pageDimensions,
    openDocument,
    goToPage,
    updateGroupText,
    updateGroupPosition,
    save,
    closeDocument,
    setScale,
  } = usePdfEditor();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);

  /**
   * Maneja la selección del archivo PDF.
   */
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Guardar buffer para renderizar en canvas
      const buffer = await file.arrayBuffer();
      setPdfBuffer(buffer);

      await openDocument(file);
      // Auto-cargar primera página
      // (goToPage se llama automáticamente con currentPage=0)
    },
    [openDocument],
  );

  /**
   * Guarda y descarga el PDF editado.
   */
  const handleSave = useCallback(async () => {
    const blob = await save();
    if (!blob) return;

    // Descargar el PDF
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'edited.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }, [save]);

  // --- UI ---

  // Pantalla de upload si no hay documento abierto
  if (!state.jobId) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '80vh',
        gap: '24px',
      }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600 }}>
          Editor de PDF
        </h1>
        <p style={{ color: '#666' }}>
          Sube un PDF para editarlo como un documento de Word
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '12px 32px',
            fontSize: '16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Seleccionar PDF
        </button>
      </div>
    );
  }

  const currentGroups = state.groups.get(state.currentPage) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* --- Toolbar --- */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#f9fafb',
      }}>
        {/* Navegación de páginas */}
        <button
          onClick={() => goToPage(Math.max(0, state.currentPage - 1))}
          disabled={state.currentPage === 0}
        >
          ← Anterior
        </button>

        <span>
          Página {state.currentPage + 1} de {state.totalPages}
        </span>

        <button
          onClick={() =>
            goToPage(Math.min(state.totalPages - 1, state.currentPage + 1))
          }
          disabled={state.currentPage >= state.totalPages - 1}
        >
          Siguiente →
        </button>

        <div style={{ flex: 1 }} />

        {/* Zoom */}
        <button onClick={() => setScale(Math.max(0.25, state.scale - 0.25))}>
          −
        </button>
        <span>{Math.round(state.scale * 100)}%</span>
        <button onClick={() => setScale(Math.min(3, state.scale + 0.25))}>
          +
        </button>

        <div style={{ flex: 1 }} />

        {/* Indicador de cambios */}
        {state.dirtyPages.size > 0 && (
          <span style={{ color: '#eab308', fontSize: '14px' }}>
            {state.dirtyPages.size} página(s) modificada(s)
          </span>
        )}

        {/* Guardar */}
        <button
          onClick={handleSave}
          disabled={state.dirtyPages.size === 0}
          style={{
            padding: '6px 20px',
            backgroundColor:
              state.dirtyPages.size > 0 ? '#22c55e' : '#d1d5db',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor:
              state.dirtyPages.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Guardar PDF
        </button>

        {/* Cerrar */}
        <button
          onClick={closeDocument}
          style={{
            padding: '6px 16px',
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Cerrar
        </button>
      </div>

      {/* --- Área del editor --- */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        backgroundColor: '#6b7280',
        padding: '24px',
      }}>
        {state.isLoading ? (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '48px',
            color: 'white',
          }}>
            Cargando página...
          </div>
        ) : (
          pageDimensions[state.currentPage] && (
            <PdfEditorPage
              pageNumber={state.currentPage}
              width={pageDimensions[state.currentPage].width}
              height={pageDimensions[state.currentPage].height}
              scale={state.scale}
              groups={currentGroups}
              pdfBuffer={pdfBuffer}
              onTextChange={updateGroupText}
              onPositionChange={updateGroupPosition}
            />
          )
        )}
      </div>
    </div>
  );
}
```

### 2.10 Página de Next.js

```tsx
// src/app/editor/page.tsx

import { PdfEditor } from '@/components/pdf-editor/PdfEditor';

export default function EditorPage() {
  return <PdfEditor />;
}
```

### 2.11 Configuración de pdf.js worker

```typescript
// next.config.js — agregar esta configuración

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdf.js necesita que el worker se sirva como archivo estático.
    // Copiar el worker a public/ o configurar webpack para servirlo.
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
```

Copiar el worker a la carpeta public:
```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

---

## Fase 3: Flujo completo

```
                         FLUJO DE EDICIÓN
                         ================

1. APERTURA
   Usuario selecciona PDF
      │
      ▼
   Frontend: POST /api/v1/pdf-editor/open (FormData con el archivo)
      │
      ▼
   Backend:
      ├─ Cachea el PDF en memoria (Map<jobId, Buffer>)
      ├─ Extrae metadata (título, autor, nº páginas)
      ├─ Extrae dimensiones de cada página
      └─ Retorna: { jobId, totalPages, fonts[], pages[{width,height}] }
      │
      ▼
   Frontend:
      ├─ Registra fonts como @font-face en el <head>
      └─ Inicializa estado del editor

2. LAZY LOADING DE PÁGINA
   Usuario navega a página N
      │
      ▼
   Frontend: GET /api/v1/pdf-editor/page/{jobId}/{N}
      │
      ▼
   Backend:
      ├─ Recupera PDF del cache
      ├─ Usa pdf.js server-side para extraer textContent de página N
      └─ Retorna: { textElements[], imageElements[] }
      │
      ▼
   Frontend:
      ├─ groupTextElements(): agrupa fragmentos en líneas/párrafos
      ├─ pdf.js renderiza la página en <canvas> (fondo visual)
      └─ Superpone <div contentEditable> por cada TextGroup

3. EDICIÓN
   Usuario hace click en texto
      │
      ▼
   placeCaretAtPoint(x, y) → posiciona cursor exactamente donde hizo click
      │
      ▼
   Usuario escribe/borra/modifica texto
      │
      ▼
   onInput → getCaretOffset() → save caret position
           → updateGroupText(pageIndex, groupId, newText)
           → marca página como dirty
           → React re-renderiza
           → requestAnimationFrame → setCaretOffset() → restaura cursor

4. DRAG & RESIZE
   Usuario arrastra un bloque de texto (react-rnd)
      │
      ▼
   onDragStop → updateGroupPosition(pageIndex, groupId, newX, newY)
              → marca página como dirty

5. GUARDADO
   Usuario clickea "Guardar PDF"
      │
      ▼
   Frontend:
      ├─ Reconstruye textElements desde los TextGroups editados
      ├─ Filtra solo las páginas en dirtyPages
      └─ POST /api/v1/pdf-editor/save/{jobId} con { pages: dirtyPagesData[] }
      │
      ▼
   Backend:
      ├─ Carga PDF original del cache
      ├─ Por cada dirty page:
      │    ├─ Elimina la página original
      │    ├─ Inserta página nueva en la misma posición
      │    └─ Escribe textElements con pdf-lib (drawText con posiciones exactas)
      ├─ Guarda PDF actualizado de vuelta al cache
      └─ Retorna el PDF como blob
      │
      ▼
   Frontend: Descarga el blob como archivo PDF

6. CIERRE
   Usuario clickea "Cerrar"
      │
      ▼
   Frontend: POST /api/v1/pdf-editor/close/{jobId}
   Backend: Elimina PDF del cache
```

---

## Fase 4: Mejoras para producción

### 4.1 Extracción de texto con posiciones precisas

La extracción precisa de texto es el aspecto más crítico. Opciones rankeadas:

| Opción | Precisión | Complejidad | Recomendación |
|--------|-----------|-------------|---------------|
| pdf.js server-side | ★★★★★ | Media | **Mejor opción** — misma lib que el frontend |
| pdf2json (npm) | ★★★★ | Baja | Buena alternativa, más simple |
| poppler pdftotext -bbox | ★★★★★ | Alta | Requiere binary nativo |
| pdf-parse | ★★ | Baja | Solo texto plano, sin posiciones |

### 4.2 Preservación de vectores y gráficos

```
Problema: al reconstruir una página, se pierden los gráficos vectoriales
          (líneas, rectángulos, paths, gradientes, etc.)

Solución de Stirling PDF:
  1. Extraer el content stream de la página original
  2. Filtrar solo los operadores de gráficos vectoriales (re, m, l, c, h, S, f, etc.)
  3. Escribir primero los vectores, luego el texto encima

Con pdf-lib esto es limitado. Para producción completa, considerar:
  - Usar Apache PDFBox via Java subprocess
  - Usar mupdf-js (binding de MuPDF a WebAssembly)
  - Usar HummusJS/muhammara para manipulación de bajo nivel
```

### 4.3 Undo/Redo

```typescript
// Agregar al usePdfEditor hook:

interface HistoryEntry {
  groups: Map<number, TextGroup[]>;
  dirtyPages: Set<number>;
}

const history = useRef<HistoryEntry[]>([]);
const historyIndex = useRef(-1);

const pushHistory = () => {
  // Clonar estado actual y añadir al historial
  const entry: HistoryEntry = {
    groups: new Map(state.groups),
    dirtyPages: new Set(state.dirtyPages),
  };
  history.current = history.current.slice(0, historyIndex.current + 1);
  history.current.push(entry);
  historyIndex.current++;
};

const undo = () => { /* restaurar historyIndex - 1 */ };
const redo = () => { /* restaurar historyIndex + 1 */ };

// Ctrl+Z / Ctrl+Y listeners
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### 4.4 Persistencia con IndexedDB (para PDFs grandes)

```typescript
// En lugar de mantener el PDF en memoria del navegador,
// usar IndexedDB para PDFs > 50MB:

import { openDB } from 'idb';

const db = await openDB('pdf-editor', 1, {
  upgrade(db) {
    db.createObjectStore('documents');
    db.createObjectStore('pages');
  },
});

// Guardar PDF original
await db.put('documents', buffer, jobId);

// Guardar páginas extraídas individualmente
await db.put('pages', pageData, `${jobId}-page-${pageNumber}`);
```

### 4.5 Estructura de archivos final

```
src/
├── app/
│   └── editor/
│       └── page.tsx                    # Página del editor
│
├── components/
│   └── pdf-editor/
│       ├── PdfEditor.tsx               # Componente raíz
│       ├── PdfEditorPage.tsx           # Página individual (canvas + overlays)
│       ├── EditableTextBlock.tsx        # Bloque de texto editable (contentEditable + rnd)
│       └── Toolbar.tsx                 # Barra de herramientas
│
├── hooks/
│   └── usePdfEditor.ts                # Estado principal del editor
│
├── services/
│   └── pdf-editor-api.ts              # Llamadas al backend
│
├── types/
│   └── pdf-editor.ts                  # TypeScript types compartidos
│
└── utils/
    ├── text-grouping.ts               # Agrupar textElements en líneas/párrafos
    └── caret.ts                       # Gestión de cursor en contentEditable

# Backend NestJS
src/
├── pdf-editor/
│   ├── pdf-editor.module.ts
│   ├── pdf-editor.controller.ts       # 6 endpoints REST
│   ├── dto/
│   │   └── pdf-json.dto.ts            # DTOs del documento JSON
│   └── services/
│       ├── pdf-extraction.service.ts  # PDF → JSON
│       ├── pdf-reconstruction.service.ts  # JSON → PDF
│       └── pdf-cache.service.ts       # Cache de PDFs
```

---

## Resumen: Diferencias clave con Stirling PDF

| Aspecto | Stirling PDF | Tu implementación |
|---------|-------------|-------------------|
| Backend | Java + Spring Boot + Apache PDFBox | NestJS + pdf-lib + pdf.js server |
| Extracción texto | PDFTextStripper (PDFBox) | pdf.js getTextContent() |
| Reconstrucción | Content stream manipulation | pdf-lib drawText() |
| Frontend framework | React (Vite) | Next.js (React) |
| Edición | contentEditable ✅ | contentEditable ✅ |
| Drag/resize | react-rnd ✅ | react-rnd ✅ |
| Lazy loading | Sí (server cache + jobId) ✅ | Sí (mismo patrón) ✅ |
| Guardado incremental | Sí (partial update) ✅ | Sí (mismo patrón) ✅ |
| Fonts embebidas | Completo (fontkit) | Parcial (necesita más trabajo) |
| Vectores/gráficos | Preserva 100% | Se pierden al reconstruir ⚠️ |

### Lo que funciona bien con este approach
- Edición de texto: click, escribir, mover bloques
- Lazy loading de páginas grandes
- Guardado incremental eficiente
- Experiencia de usuario similar a Word

### Limitaciones a resolver para producción
1. **Preservación de vectores**: pdf-lib no puede manipular content streams existentes. Considerar mupdf-js o subprocess de PDFBox
2. **Fonts embebidas**: Extraer fonts embebidas requiere parseo de bajo nivel del PDF
3. **Tablas y layouts complejos**: La agrupación de texto puede fallar con layouts tabulares
4. **RTL y texto complejo**: Necesita manejo especial para árabe, hebreo, etc.
