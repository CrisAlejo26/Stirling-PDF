package stirling.software.SPDF.model.api.security;

import org.springframework.web.multipart.MultipartFile;

import io.swagger.v3.oas.annotations.media.Schema;

import lombok.Data;

@Data
public class EncryptByFieldRequest {

    @Schema(description = "Input PDF files to encrypt", requiredMode = Schema.RequiredMode.REQUIRED)
    private MultipartFile[] fileInput;

    @Schema(
            description =
                    "Encryption strategy: 'fixed_password' uses the same password for all files;"
                            + " 'field_value' reads a different password from inside each PDF"
                            + " (e.g. the worker's NIF).",
            allowableValues = {"fixed_password", "field_value"},
            requiredMode = Schema.RequiredMode.REQUIRED)
    private String encryptMode;

    @Schema(
            description = "Password applied to all files when encryptMode=fixed_password.",
            format = "password")
    private String password;

    @Schema(
            description =
                    "AcroForm field name inside the PDF whose value is used as the per-file"
                            + " password (used when encryptMode=field_value)."
                            + " Example: 'trabajador_nif'."
                            + " If the field is not found as an AcroForm field, a spatial label"
                            + " search is attempted using labelSearchText.")
    private String fieldName;

    @Schema(
            description =
                    "Label text to search for spatially when the AcroForm field is not present"
                            + " (e.g. 'N.I.F.', 'NIF'). Dots, colons and spaces are normalised"
                            + " before matching.")
    private String labelSearchText;

    @Schema(
            description =
                    "Position of the label relative to its value when doing a label search."
                            + " Use 'auto' to try all directions automatically.",
            allowableValues = {"auto", "right", "left", "below", "above"},
            defaultValue = "auto")
    private String labelPosition = "auto";

    @Schema(
            description = "AES encryption key length in bits.",
            allowableValues = {"128", "256"},
            defaultValue = "256")
    private int keyLength = 256;

    @Schema(
            description =
                    "When true, applies OCR to each PDF that has no selectable text layer before"
                            + " attempting field extraction. Useful for image-based PDFs (scanned"
                            + " nóminas, etc.). Requires Tesseract or OCRmyPDF to be installed."
                            + " If the server-level setting system.ocrForFieldExtraction is already"
                            + " true, this parameter is redundant but harmless.",
            defaultValue = "false")
    private boolean ocrForExtraction = false;
}
