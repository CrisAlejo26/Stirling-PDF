package stirling.software.SPDF.model.api.misc;

import org.springframework.web.multipart.MultipartFile;

import io.swagger.v3.oas.annotations.media.Schema;

import lombok.Data;

@Data
public class RenameByFieldRequest {

    @Schema(description = "Input PDF files to rename", requiredMode = Schema.RequiredMode.REQUIRED)
    private MultipartFile[] fileInput;

    @Schema(
            description =
                    "Rename strategy: 'custom_text' uses a fixed base name with sequential"
                            + " suffixes (e.g. trabajador_1.pdf, trabajador_2.pdf);"
                            + " 'field_value' reads a value from inside each PDF to use as the"
                            + " file name.",
            allowableValues = {"custom_text", "field_value"},
            requiredMode = Schema.RequiredMode.REQUIRED)
    private String renameMode;

    @Schema(
            description =
                    "Base text for naming when renameMode=custom_text. Each file will be named"
                            + " '<customText>_1.pdf', '<customText>_2.pdf', etc.")
    private String customText;

    @Schema(
            description =
                    "AcroForm field name inside the PDF whose value becomes the file name"
                            + " (used when renameMode=field_value). Example: 'trabajador_nombre'."
                            + " If the field is not found as an AcroForm field, a spatial label"
                            + " search is attempted using labelSearchText.")
    private String fieldName;

    @Schema(
            description =
                    "Label text to search for spatially when the AcroForm field is not present"
                            + " (e.g. 'N.I.F.', 'Apellidos y Nombre'). The extractor normalises"
                            + " dots, colons and spaces before matching, so 'N.I.F.' will match"
                            + " 'NIF', 'N.I.F' etc.")
    private String labelSearchText;

    @Schema(
            description =
                    "Position of the label relative to its value when doing a label search."
                            + " Use 'auto' to try all directions automatically.",
            allowableValues = {"auto", "right", "left", "below", "above"},
            defaultValue = "auto")
    private String labelPosition = "auto";

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
