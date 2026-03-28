package stirling.software.SPDF.controller.api.security;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import io.swagger.v3.oas.annotations.Operation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import stirling.software.SPDF.config.swagger.MultiFileResponse;
import stirling.software.SPDF.model.api.security.EncryptByFieldRequest;
import stirling.software.SPDF.service.OcrPdfService;
import stirling.software.common.annotations.AutoJobPostMapping;
import stirling.software.common.annotations.api.SecurityApi;
import stirling.software.common.service.CustomPDFDocumentFactory;
import stirling.software.common.util.PdfFieldTextExtractor;
import stirling.software.common.util.TempFile;
import stirling.software.common.util.TempFileManager;
import stirling.software.common.util.WebResponseUtils;

/**
 * Encrypts one or more PDF files using either a fixed password or a per-file password extracted
 * from inside each PDF (AcroForm field or spatial label search such as "N.I.F.").
 *
 * <p>Endpoint: {@code POST /api/v1/security/encrypt-pdfs}
 *
 * <p>Input: multiple PDFs + encryption configuration → Output: ZIP with encrypted PDFs (file names
 * are preserved).
 */
@SecurityApi
@Slf4j
@RequiredArgsConstructor
public class EncryptByFieldController {

    private final CustomPDFDocumentFactory pdfDocumentFactory;
    private final TempFileManager tempFileManager;
    private final OcrPdfService ocrPdfService;

    @AutoJobPostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE, value = "/encrypt-pdfs")
    @MultiFileResponse
    @Operation(
            summary = "Encrypt PDF files with a fixed or per-file password read from each PDF",
            description =
                    "Accepts multiple PDF files and encrypts each one with AES-256 (or AES-128)."
                            + " The password can be the same for all files ('fixed_password' mode)"
                            + " or extracted individually from inside each PDF ('field_value' mode)"
                            + " via an AcroForm field name or a spatial label search"
                            + " (e.g. 'N.I.F.', 'NIF'). Labels may be above, below, left or right"
                            + " of their values. Returns a ZIP archive preserving original file"
                            + " names. Input:PDF Output:PDF Type:MIMO")
    public ResponseEntity<StreamingResponseBody> encryptPdfs(
            @ModelAttribute EncryptByFieldRequest request) throws IOException {

        MultipartFile[] files = request.getFileInput();
        String encryptMode = request.getEncryptMode();

        TempFile outputTempFile = new TempFile(tempFileManager, ".zip");

        try (ZipOutputStream zipOut =
                new ZipOutputStream(Files.newOutputStream(outputTempFile.getPath()))) {

            Map<String, Integer> usedNames = new HashMap<>();

            for (MultipartFile file : files) {
                // Apply OCR if requested (per-request flag or global server setting)
                byte[] ocrBytes =
                        ocrPdfService.ocrIfNeeded(file.getBytes(), request.isOcrForExtraction());

                String password = resolvePassword(file, ocrBytes, request, encryptMode);

                if (password == null || password.isBlank()) {
                    log.warn(
                            "No password resolved for '{}'; file will be added unencrypted",
                            file.getOriginalFilename());
                }

                byte[] encryptedBytes =
                        encryptPdf(file, ocrBytes, password, request.getKeyLength());

                String rawName =
                        file.getOriginalFilename() != null
                                ? file.getOriginalFilename()
                                : "archivo.pdf";
                String entryName = resolveUniqueName(rawName, usedNames);

                zipOut.putNextEntry(new ZipEntry(entryName));
                zipOut.write(encryptedBytes);
                zipOut.closeEntry();

                log.debug(
                        "Encrypted '{}' (keyLength={}, passwordSource={})",
                        entryName,
                        request.getKeyLength(),
                        encryptMode);
            }
        }

        return WebResponseUtils.zipFileToWebResponse(outputTempFile, "encrypted_pdfs.zip");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Resolves the password to use for a given file based on the encrypt mode. If {@code ocrBytes}
     * is non-null it is used instead of the original file for text extraction. Returns {@code null}
     * if the mode is "field_value" and no value could be extracted.
     */
    private String resolvePassword(
            MultipartFile file, byte[] ocrBytes, EncryptByFieldRequest request, String encryptMode)
            throws IOException {

        if ("fixed_password".equalsIgnoreCase(encryptMode)) {
            return request.getPassword();
        }

        // "field_value" mode: read password from inside the PDF
        try (PDDocument document =
                ocrBytes != null
                        ? pdfDocumentFactory.load(ocrBytes)
                        : pdfDocumentFactory.load(file)) {
            String value = null;

            // 1. AcroForm field lookup
            if (request.getFieldName() != null && !request.getFieldName().isBlank()) {
                value = PdfFieldTextExtractor.extractByFieldName(document, request.getFieldName());
                if (value != null)
                    log.debug(
                            "Password from AcroForm field '{}': '{}'",
                            request.getFieldName(),
                            value);
            }

            // 2. Spatial label search fallback
            if (value == null
                    && request.getLabelSearchText() != null
                    && !request.getLabelSearchText().isBlank()) {
                value =
                        PdfFieldTextExtractor.extractByLabelSearch(
                                document, request.getLabelSearchText(), request.getLabelPosition());
                if (value != null)
                    log.debug(
                            "Password from label search '{}': '{}'",
                            request.getLabelSearchText(),
                            value);
            }

            if (value == null) {
                log.warn(
                        "Could not extract password field from '{}' (fieldName='{}', label='{}')",
                        file.getOriginalFilename(),
                        request.getFieldName(),
                        request.getLabelSearchText());
            }

            return value;
        }
    }

    /**
     * Encrypts the given PDF with the supplied password using AES-{keyLength}. If {@code ocrBytes}
     * is non-null it is used as the source document (already has a text layer). If {@code password}
     * is {@code null} or blank, the document is saved without encryption.
     */
    private byte[] encryptPdf(MultipartFile file, byte[] ocrBytes, String password, int keyLength)
            throws IOException {

        try (PDDocument document =
                        ocrBytes != null
                                ? pdfDocumentFactory.load(ocrBytes)
                                : pdfDocumentFactory.load(file);
                ByteArrayOutputStream baos = new ByteArrayOutputStream()) {

            if (password != null && !password.isBlank()) {
                AccessPermission ap = new AccessPermission();
                // All permissions granted – only opening requires the password
                ap.setCanAssembleDocument(true);
                ap.setCanExtractContent(true);
                ap.setCanExtractForAccessibility(true);
                ap.setCanFillInForm(true);
                ap.setCanModify(true);
                ap.setCanModifyAnnotations(true);
                ap.setCanPrint(true);
                ap.setCanPrintFaithful(true);

                StandardProtectionPolicy spp = new StandardProtectionPolicy(password, password, ap);
                spp.setEncryptionKeyLength(keyLength);
                spp.setPermissions(ap);
                document.protect(spp);
            }

            document.save(baos);
            return baos.toByteArray();
        }
    }

    /** Ensures the ZIP entry name is unique by appending {@code _2}, {@code _3}, etc. */
    private String resolveUniqueName(String proposedName, Map<String, Integer> usedNames) {
        String key = proposedName.toLowerCase();
        int count = usedNames.getOrDefault(key, 0) + 1;
        usedNames.put(key, count);
        if (count == 1) return proposedName;
        int dot = proposedName.lastIndexOf('.');
        return dot >= 0
                ? proposedName.substring(0, dot) + "_" + count + proposedName.substring(dot)
                : proposedName + "_" + count;
    }
}
