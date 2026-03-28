package stirling.software.SPDF.service;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

import javax.imageio.ImageIO;

import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import stirling.software.SPDF.config.EndpointConfiguration;
import stirling.software.common.configuration.RuntimePathConfig;
import stirling.software.common.model.ApplicationProperties;
import stirling.software.common.service.CustomPDFDocumentFactory;
import stirling.software.common.util.ProcessExecutor;
import stirling.software.common.util.ProcessExecutor.ProcessExecutorResult;
import stirling.software.common.util.TempDirectory;
import stirling.software.common.util.TempFile;
import stirling.software.common.util.TempFileManager;

/**
 * Applies OCR to a PDF when it contains no selectable text and the system setting {@code
 * system.ocrForFieldExtraction} is enabled. Used by rename-pdfs and encrypt-pdfs endpoints to
 * support image-based PDFs (e.g. scanned nóminas).
 *
 * <p>Returns {@code null} when OCR is not needed or not available, so callers can use the original
 * file unchanged.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class OcrPdfService {

    /** OCR languages tried in order for Spanish documents. */
    private static final List<String> FIELD_EXTRACTION_LANGS = List.of("spa", "eng");

    private final ApplicationProperties applicationProperties;
    private final EndpointConfiguration endpointConfiguration;
    private final RuntimePathConfig runtimePathConfig;
    private final TempFileManager tempFileManager;
    private final CustomPDFDocumentFactory pdfDocumentFactory;

    /**
     * Returns OCR-processed PDF bytes if OCR is requested (either via the {@code requestParam} flag
     * sent by the caller or via the global server setting {@code system.ocrForFieldExtraction}) AND
     * the PDF has no extractable text layer AND an OCR tool is available.
     *
     * <p>Returns {@code null} otherwise — callers should use the original file unchanged.
     *
     * @param pdfBytes raw bytes of the input PDF
     * @param requestParam per-request OCR flag (e.g. sent by the frontend as {@code
     *     ocrForExtraction=true})
     * @return OCR'd PDF bytes, or {@code null}
     */
    public byte[] ocrIfNeeded(byte[] pdfBytes, boolean requestParam) throws IOException {
        boolean enabled =
                requestParam || applicationProperties.getSystem().isOcrForFieldExtraction();
        if (!enabled) {
            return null;
        }
        if (hasExtractableText(pdfBytes)) {
            log.debug("PDF already contains a text layer – OCR skipped");
            return null;
        }
        log.debug("PDF has no text layer and ocrForFieldExtraction=true – running OCR");
        return runOcr(pdfBytes);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private boolean hasExtractableText(byte[] pdfBytes) throws IOException {
        try (var doc = pdfDocumentFactory.load(pdfBytes)) {
            PDFTextStripper stripper = new PDFTextStripper();
            String text = stripper.getText(doc);
            return text != null && !text.isBlank();
        }
    }

    /**
     * Runs OCR on the given PDF bytes. Prefers OCRmyPDF when available; falls back to direct
     * Tesseract processing. Returns {@code null} if no OCR tool is installed or if OCR fails —
     * callers will use the original file unchanged instead of propagating the error.
     */
    private byte[] runOcr(byte[] pdfBytes) throws IOException {
        try (TempFile inputFile = new TempFile(tempFileManager, ".pdf");
                TempFile outputFile = new TempFile(tempFileManager, ".pdf")) {

            Files.write(inputFile.getPath(), pdfBytes);

            boolean ocred = false;
            try {
                if (endpointConfiguration.isGroupEnabled("OCRmyPDF")) {
                    ocred = runOcrMyPdf(inputFile, outputFile);
                } else if (endpointConfiguration.isGroupEnabled("tesseract")) {
                    ocred = runTesseract(inputFile, outputFile);
                } else {
                    log.warn(
                            "ocrForExtraction requested but no OCR tool (OCRmyPDF / tesseract)"
                                    + " is available – field extraction will use original PDF");
                    return null;
                }
            } catch (IOException | InterruptedException e) {
                log.warn(
                        "OCR tool failed ({}); field extraction will use original PDF."
                                + " Install Tesseract or OCRmyPDF to enable OCR support.",
                        e.getMessage());
                if (e instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                return null;
            }

            if (!ocred) {
                log.warn("OCR processing produced no output – falling back to original PDF");
                return null;
            }
            return Files.readAllBytes(outputFile.getPath());
        }
    }

    /**
     * Runs OCRmyPDF with {@code --force-ocr} to ensure the image-based PDF gets a text layer. Uses
     * Spanish + English languages. Returns {@code true} if the output file was produced.
     */
    private boolean runOcrMyPdf(TempFile inputFile, TempFile outputFile)
            throws IOException, InterruptedException {

        String langs = resolveLangs("OCRmyPDF");
        List<String> command =
                Arrays.asList(
                        runtimePathConfig.getOcrMyPdfPath(),
                        "--force-ocr",
                        "--language",
                        langs,
                        "--output-type",
                        "pdf",
                        "--pdf-renderer",
                        "sandwich",
                        "--invalidate-digital-signatures",
                        inputFile.getPath().toString(),
                        outputFile.getPath().toString());

        ProcessExecutorResult result =
                ProcessExecutor.getInstance(ProcessExecutor.Processes.OCR_MY_PDF)
                        .runCommandWithOutputHandling(command);

        if (result.getRc() != 0) {
            log.warn(
                    "OCRmyPDF exited with code {} – falling back to Tesseract if available",
                    result.getRc());
            if (endpointConfiguration.isGroupEnabled("tesseract")) {
                return runTesseract(inputFile, outputFile);
            }
            return false;
        }
        return Files.exists(outputFile.getPath()) && Files.size(outputFile.getPath()) > 0;
    }

    /**
     * Runs Tesseract directly: renders each page to PNG at 300 DPI using PDFBox, then calls
     * Tesseract to produce a searchable-PDF page, and merges all pages with PDFMerger.
     */
    private boolean runTesseract(TempFile inputFile, TempFile outputFile)
            throws IOException, InterruptedException {

        String langs = resolveLangs("tesseract");

        // Build minimal ocrmypdf-style single-page command using tesseract's built-in PDF output.
        // We render per-page with PDFBox then merge, mirroring OCRController.processWithTesseract.
        PDFMergerUtility merger = new PDFMergerUtility();
        merger.setDestinationFileName(outputFile.getPath().toString());

        try (var doc = pdfDocumentFactory.load(inputFile.getPath());
                var tempDir = new TempDirectory(tempFileManager)) {

            PDFRenderer pdfRenderer = new PDFRenderer(doc);
            pdfRenderer.setSubsamplingAllowed(true);
            int pageCount = doc.getNumberOfPages();

            for (int pageNum = 0; pageNum < pageCount; pageNum++) {
                BufferedImage image = pdfRenderer.renderImageWithDPI(pageNum, 300);
                File imagePath =
                        tempDir.getPath()
                                .resolve(String.format(Locale.ROOT, "page_%d.png", pageNum))
                                .toFile();
                ImageIO.write(image, "png", imagePath);

                String outputBase =
                        tempDir.getPath()
                                .resolve(String.format(Locale.ROOT, "page_%d", pageNum))
                                .toString();

                List<String> cmd =
                        Arrays.asList(
                                "tesseract", imagePath.toString(), outputBase, "-l", langs, "pdf");

                ProcessExecutorResult result =
                        ProcessExecutor.getInstance(ProcessExecutor.Processes.TESSERACT)
                                .runCommandWithOutputHandling(cmd);

                if (result.getRc() != 0) {
                    log.warn(
                            "Tesseract failed on page {} with exit code {}",
                            pageNum,
                            result.getRc());
                    return false;
                }

                File pageOutputPath =
                        tempDir.getPath()
                                .resolve(String.format(Locale.ROOT, "page_%d.pdf", pageNum))
                                .toFile();
                if (pageOutputPath.exists()) {
                    merger.addSource(pageOutputPath);
                }
            }
        }

        merger.mergeDocuments(null);
        return Files.exists(outputFile.getPath()) && Files.size(outputFile.getPath()) > 0;
    }

    /**
     * Resolves which languages to pass to the OCR tool, filtering to only those available on the
     * system. Always tries Spanish first, then English as fallback.
     */
    private String resolveLangs(String tool) {
        String tessdataDir = runtimePathConfig.getTessDataPath();
        File dir = new File(tessdataDir);
        File[] files = dir.listFiles();

        if (files == null) {
            // tessdata dir unreadable – try spa+eng and let the tool fail if absent
            return "spa+eng";
        }

        Set<String> available =
                Arrays.stream(files)
                        .filter(f -> f.getName().endsWith(".traineddata"))
                        .map(f -> f.getName().replace(".traineddata", ""))
                        .collect(Collectors.toSet());

        List<String> chosen = FIELD_EXTRACTION_LANGS.stream().filter(available::contains).toList();

        if (chosen.isEmpty()) {
            log.warn(
                    "None of the preferred OCR languages {} found in tessdata; trying 'eng'",
                    FIELD_EXTRACTION_LANGS);
            return "eng";
        }
        return String.join("+", chosen);
    }
}
