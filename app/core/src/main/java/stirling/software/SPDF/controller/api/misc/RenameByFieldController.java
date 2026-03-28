package stirling.software.SPDF.controller.api.misc;

import java.io.IOException;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import io.swagger.v3.oas.annotations.Operation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import stirling.software.SPDF.config.swagger.MultiFileResponse;
import stirling.software.SPDF.model.api.misc.RenameByFieldRequest;
import stirling.software.SPDF.service.OcrPdfService;
import stirling.software.common.annotations.AutoJobPostMapping;
import stirling.software.common.annotations.api.MiscApi;
import stirling.software.common.service.CustomPDFDocumentFactory;
import stirling.software.common.util.PdfFieldTextExtractor;
import stirling.software.common.util.RegexPatternUtils;
import stirling.software.common.util.TempFile;
import stirling.software.common.util.TempFileManager;
import stirling.software.common.util.WebResponseUtils;

/**
 * Renames one or more PDF files using either a custom base text (with sequential numbering) or a
 * value extracted directly from inside each PDF (AcroForm field or spatial label search).
 *
 * <p>Endpoint: {@code POST /api/v1/misc/rename-pdfs}
 *
 * <p>Input: multiple PDFs + rename configuration → Output: ZIP with renamed PDFs.
 */
@MiscApi
@Slf4j
@RequiredArgsConstructor
public class RenameByFieldController {

    private final CustomPDFDocumentFactory pdfDocumentFactory;
    private final TempFileManager tempFileManager;
    private final OcrPdfService ocrPdfService;

    @AutoJobPostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE, value = "/rename-pdfs")
    @MultiFileResponse
    @Operation(
            summary = "Rename PDF files using a custom text or a value read from each PDF",
            description =
                    "Accepts multiple PDF files and renames each one using either a fixed base"
                            + " name with sequential numbering (e.g. trabajador_1.pdf,"
                            + " trabajador_2.pdf) or a value extracted from inside the PDF"
                            + " (AcroForm field or spatial label search such as 'N.I.F.' or"
                            + " 'Apellidos y Nombre'). Returns a ZIP archive with the renamed"
                            + " files. Input:PDF Output:PDF Type:MIMO")
    public ResponseEntity<StreamingResponseBody> renamePdfs(
            @ModelAttribute RenameByFieldRequest request) throws IOException {

        MultipartFile[] files = request.getFileInput();
        String renameMode = request.getRenameMode();

        TempFile outputTempFile = new TempFile(tempFileManager, ".zip");

        try (ZipOutputStream zipOut =
                new ZipOutputStream(Files.newOutputStream(outputTempFile.getPath()))) {

            // Track used names to detect duplicates across all files
            Map<String, Integer> usedNames = new HashMap<>();

            for (int i = 0; i < files.length; i++) {
                MultipartFile file = files[i];

                // Apply OCR if requested (per-request flag or global server setting)
                byte[] ocrBytes =
                        ocrPdfService.ocrIfNeeded(file.getBytes(), request.isOcrForExtraction());

                String outputName;
                if ("custom_text".equalsIgnoreCase(renameMode)) {
                    outputName = buildSequentialName(request.getCustomText(), i + 1);
                } else {
                    outputName = extractNameFromPdf(file, ocrBytes, request, i + 1);
                }

                outputName = resolveUniqueName(outputName, usedNames);

                // Save OCR'd version if available so the output has a searchable text layer
                byte[] pdfBytes;
                if (ocrBytes != null) {
                    pdfBytes = ocrBytes;
                } else {
                    try (PDDocument document = pdfDocumentFactory.load(file)) {
                        pdfBytes = toBytes(document);
                    }
                }

                zipOut.putNextEntry(new ZipEntry(outputName));
                zipOut.write(pdfBytes);
                zipOut.closeEntry();

                log.debug("Renamed file [{}] → '{}'", file.getOriginalFilename(), outputName);
            }
        }

        return WebResponseUtils.zipFileToWebResponse(outputTempFile, "renamed_pdfs.zip");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Builds a sequential name: "{baseText}_{index}.pdf". Falls back to "archivo_{index}.pdf" if
     * baseText is blank.
     */
    private String buildSequentialName(String baseText, int index) {
        String base =
                (baseText != null && !baseText.isBlank()) ? sanitizeFilename(baseText) : "archivo";
        return base + "_" + index + ".pdf";
    }

    /**
     * Extracts the desired file name from inside the PDF using the configured strategy. Falls back
     * to "{originalName_index}.pdf" if extraction fails. If {@code ocrBytes} is non-null it is used
     * instead of the original file (the PDF was image-based and has been OCR'd).
     */
    private String extractNameFromPdf(
            MultipartFile file, byte[] ocrBytes, RenameByFieldRequest request, int index)
            throws IOException {

        try (PDDocument document =
                ocrBytes != null
                        ? pdfDocumentFactory.load(ocrBytes)
                        : pdfDocumentFactory.load(file)) {
            String value = null;

            // 1. Try AcroForm field lookup
            if (request.getFieldName() != null && !request.getFieldName().isBlank()) {
                value = PdfFieldTextExtractor.extractByFieldName(document, request.getFieldName());
                if (value != null)
                    log.debug(
                            "Value from AcroForm field '{}': '{}'", request.getFieldName(), value);
            }

            // 2. Fall back to spatial label search
            if (value == null
                    && request.getLabelSearchText() != null
                    && !request.getLabelSearchText().isBlank()) {
                value =
                        PdfFieldTextExtractor.extractByLabelSearch(
                                document, request.getLabelSearchText(), request.getLabelPosition());
                if (value != null)
                    log.debug(
                            "Value from label search '{}': '{}'",
                            request.getLabelSearchText(),
                            value);
            }

            if (value != null && !value.isBlank()) {
                return sanitizeFilename(value) + ".pdf";
            }
        }

        // 3. Nothing found – keep original name to avoid information loss
        log.warn(
                "Could not extract name from '{}', using original name with index",
                file.getOriginalFilename());
        String original = file.getOriginalFilename();
        String base =
                (original != null && original.contains("."))
                        ? original.substring(0, original.lastIndexOf('.'))
                        : (original != null ? original : "archivo");
        return sanitizeFilename(base) + "_" + index + ".pdf";
    }

    /**
     * Sanitizes a string so it can be used safely as a filename: removes characters that are not
     * letters, digits, spaces, hyphens or underscores, collapses multiple spaces, trims, and
     * truncates to 200 characters.
     */
    private String sanitizeFilename(String value) {
        String safe =
                RegexPatternUtils.getInstance()
                        .getSafeFilenamePattern()
                        .matcher(value)
                        .replaceAll("")
                        .trim();
        if (safe.isBlank()) safe = "archivo";
        return safe.length() > 200 ? safe.substring(0, 200) : safe;
    }

    /**
     * Ensures the output name is unique within the ZIP by appending {@code _2}, {@code _3}, etc.
     * when a name collision is detected.
     */
    private String resolveUniqueName(String proposedName, Map<String, Integer> usedNames) {
        String key = proposedName.toLowerCase();
        int count = usedNames.getOrDefault(key, 0) + 1;
        usedNames.put(key, count);

        if (count == 1) return proposedName;

        // Insert counter before the .pdf extension
        int dot = proposedName.lastIndexOf('.');
        if (dot >= 0) {
            return proposedName.substring(0, dot) + "_" + count + proposedName.substring(dot);
        }
        return proposedName + "_" + count;
    }

    /** Serialize an open PDDocument to a byte array. */
    private byte[] toBytes(PDDocument document) throws IOException {
        try (java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
            document.save(baos);
            return baos.toByteArray();
        }
    }
}
