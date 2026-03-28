package stirling.software.common.util;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.interactive.form.PDAcroForm;
import org.apache.pdfbox.pdmodel.interactive.form.PDField;
import org.apache.pdfbox.pdmodel.interactive.form.PDTerminalField;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

import lombok.experimental.UtilityClass;
import lombok.extern.slf4j.Slf4j;

/**
 * Utility for extracting text values from a PDF either by AcroForm field name or by spatial
 * proximity to a label text (supporting labels placed above, below, left, or right of their values,
 * including formats like "N.I.F." or "Apellidos y Nombre").
 */
@Slf4j
@UtilityClass
public class PdfFieldTextExtractor {

    /**
     * Vertical tolerance (in PDF points) to consider two text positions as being on the same line.
     * 1 pt ≈ 0.35 mm; 4 pt covers minor baseline differences within a line.
     */
    private static final float LINE_GAP_THRESHOLD = 4.0f;

    /**
     * Horizontal gap (in PDF points) between consecutive characters that triggers a column split
     * within the same Y-group. Normal word spacing is 2–5 pt; form column gaps are typically 15
     * pt+. 12 pt ≈ 4 mm separates adjacent form columns while keeping multi-word labels intact.
     */
    private static final float COLUMN_GAP_THRESHOLD = 12.0f;

    /**
     * Horizontal tolerance (in PDF points) for considering a segment as "same column" as the label
     * when looking above/below. 60 pt ≈ 2.1 cm, generous enough for slightly indented fields.
     */
    private static final float COLUMN_ALIGN_THRESHOLD = 60.0f;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Extract a field value from an AcroForm field by its fully-qualified or partial name.
     * Comparison is case-insensitive.
     *
     * @param document PDF document (must be open)
     * @param fieldName exact AcroForm field name (e.g. "nif", "trabajador.nombre")
     * @return trimmed field value, or {@code null} if not found / empty
     */
    public String extractByFieldName(PDDocument document, String fieldName) {
        if (document == null || fieldName == null || fieldName.isBlank()) return null;

        PDAcroForm acroForm = document.getDocumentCatalog().getAcroForm();
        if (acroForm == null) return null;

        for (PDField field : acroForm.getFieldTree()) {
            if (!(field instanceof PDTerminalField)) continue;
            String name = field.getFullyQualifiedName();
            if (name == null) name = field.getPartialName();
            if (fieldName.equalsIgnoreCase(name)) {
                String val = field.getValueAsString();
                return (val != null && !val.isBlank()) ? val.trim() : null;
            }
        }
        return null;
    }

    /**
     * Extract a value by finding a label text and returning the text nearest to it.
     *
     * <p>The label is located using normalized comparison that collapses dots, colons, hyphens and
     * spaces, so "N.I.F." matches "NIF", "Apellidos y Nombre:" matches "ApllidosyNombre", etc.
     *
     * <p>Once the label row is found, the value is searched in this order (all tried for "auto"):
     *
     * <ol>
     *   <li><b>right</b> – text in the same row to the right of the label
     *   <li><b>left</b> – text in the same row to the left of the label
     *   <li><b>below</b> – text in the next 1–3 rows at a similar X column position
     *   <li><b>above</b> – text in the previous 1–3 rows at a similar X column position
     * </ol>
     *
     * @param document PDF document (must be open)
     * @param labelText Label to search for (e.g. "N.I.F.", "Apellidos y Nombre")
     * @param labelPosition Direction hint: "auto" | "right" | "left" | "below" | "above"
     * @return trimmed value text, or {@code null} if the label or its value could not be found
     */
    public String extractByLabelSearch(PDDocument document, String labelText, String labelPosition)
            throws IOException {

        if (document == null || labelText == null || labelText.isBlank()) return null;

        List<TextRow> rows = extractRows(document);
        if (rows.isEmpty()) return null;

        String pos =
                (labelPosition == null || labelPosition.isBlank())
                        ? "auto"
                        : labelPosition.toLowerCase().trim();
        String normalizedLabel = normalize(labelText);

        for (int i = 0; i < rows.size(); i++) {
            TextRow row = rows.get(i);

            // Match against the full row text so multi-word labels like "Apellidos y Nombre"
            // are always found even when word gaps in the PDF exceed COLUMN_GAP_THRESHOLD.
            if (!normalize(row.fullText).contains(normalizedLabel)) continue;

            // Find the X position of the specific column segment that contains the label,
            // so we align correctly when searching above/below in multi-column forms.
            float labelX = resolveSegmentX(row, normalizedLabel);

            if ("right".equals(pos) || "auto".equals(pos)) {
                // Search within the label's own segment only, so we don't accidentally
                // return a sibling column label (e.g. "Cargo") that follows on the same row.
                String labelSegText = findSegmentContaining(row, normalizedLabel);
                String after =
                        textAfterLabel(
                                labelSegText != null ? labelSegText : row.fullText, labelText);
                // Only accept results that contain at least one letter or digit.
                // Rejects punctuation-only leftovers like ":" that appear when the label ends
                // with a colon and the value is in a separate OCR segment on the same row.
                if (after != null && after.matches(".*[\\p{L}\\d].*")) {
                    return extractFirstToken(after.trim());
                }
                // Fallback: if the label was found in a specific segment but the value is in
                // the next segment(s) of the same row (common in OCR'd PDFs where label and
                // value are separated by a large gap), look at subsequent segments.
                if (labelSegText != null) {
                    String nextSeg = findNextSegmentText(row, normalizedLabel);
                    if (nextSeg != null && !nextSeg.isBlank()) {
                        return extractFirstToken(nextSeg.trim());
                    }
                }
            }

            if ("left".equals(pos) || "auto".equals(pos)) {
                String labelSegText = findSegmentContaining(row, normalizedLabel);
                String before =
                        textBeforeLabel(
                                labelSegText != null ? labelSegText : row.fullText, labelText);
                if (before != null && !before.isBlank()) return extractFirstToken(before.trim());
            }

            if ("below".equals(pos) || "auto".equals(pos)) {
                // When the caller specifies "below" explicitly they know the value is
                // directly underneath the label, even if the X positions don't align
                // (e.g. nóminas where the header row is indented but the value row
                // starts at the left margin). In "auto" mode keep strict alignment to
                // avoid picking up the wrong column in multi-column forms.
                boolean strict = "auto".equals(pos);
                String value = findAdjacentValue(rows, i, labelX, normalizedLabel, true, strict);
                if (value != null) return value;
            }

            if ("above".equals(pos) || "auto".equals(pos)) {
                boolean strict = "auto".equals(pos);
                String value = findAdjacentValue(rows, i, labelX, normalizedLabel, false, strict);
                if (value != null) return value;
            }
        }

        log.debug("Label '{}' not found or value not extractable from PDF text", labelText);
        return null;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Finds the X position of the column segment that contains {@code normalizedLabel}. Iterates
     * the row's segments and returns the {@code startX} of the first segment whose normalized text
     * contains the label. Falls back to the row's own {@code startX} if none match (e.g. the label
     * spans multiple segments due to unusual spacing).
     */
    private float resolveSegmentX(TextRow row, String normalizedLabel) {
        for (TextSegment seg : row.segments) {
            if (normalize(seg.text).contains(normalizedLabel)) {
                return seg.startX;
            }
        }
        // Fallback: label spans segment boundaries — use the row's leftmost X
        return row.startX;
    }

    /**
     * Returns the text of the segment that contains {@code normalizedLabel}, or {@code null} if no
     * single segment contains the full label (e.g. label spans boundaries).
     */
    private String findSegmentContaining(TextRow row, String normalizedLabel) {
        for (TextSegment seg : row.segments) {
            if (normalize(seg.text).contains(normalizedLabel)) {
                return seg.text;
            }
        }
        return null;
    }

    /**
     * Returns the text of the first segment that comes <em>after</em> the segment containing {@code
     * normalizedLabel} in the same row. Used when the value is a separate OCR segment on the same
     * visual line as the label (e.g. label="Apellidos y Nombre:" in seg 0, value="GARCIA LOPEZ,
     * IVAN" in seg 1).
     *
     * <p>Returns {@code null} if the label segment is the last one or is not found.
     */
    private String findNextSegmentText(TextRow row, String normalizedLabel) {
        List<TextSegment> segs = row.segments;
        for (int idx = 0; idx < segs.size() - 1; idx++) {
            if (normalize(segs.get(idx).text).contains(normalizedLabel)) {
                return segs.get(idx + 1).text;
            }
        }
        return null;
    }

    /**
     * Search for a value in adjacent rows (forward = below, backward = above). Looks across up to 3
     * distinct Y-rows.
     *
     * <p>When {@code strictAlign} is {@code true} (used by {@code auto} mode), only segments whose
     * X position is within {@link #COLUMN_ALIGN_THRESHOLD} of {@code labelX} are considered, and
     * the closest one by X distance is selected.
     *
     * <p>When {@code strictAlign} is {@code false} (used when the caller passes {@code below} or
     * {@code above} explicitly), the segment whose X position is closest to {@code labelX} is
     * selected (no threshold filter). This handles multi-column forms where the value is directly
     * underneath the label regardless of X offset.
     */
    private String findAdjacentValue(
            List<TextRow> rows,
            int labelRowIdx,
            float labelX,
            String normalizedLabel,
            boolean forward,
            boolean strictAlign) {

        int step = forward ? 1 : -1;
        int rowsExamined = 0;

        for (int j = labelRowIdx + step; forward ? j < rows.size() : j >= 0; j += step) {
            TextRow candidate = rows.get(j);
            rowsExamined++;
            if (rowsExamined > 3) break;

            // Find the segment closest in X to the label, not just the first one
            TextSegment bestSeg = null;
            float bestDist = Float.MAX_VALUE;

            for (TextSegment seg : candidate.segments) {
                if (seg.text.isBlank() || normalize(seg.text).contains(normalizedLabel)) continue;

                float dist = Math.abs(seg.startX - labelX);
                if (strictAlign && dist > COLUMN_ALIGN_THRESHOLD) continue;

                if (dist < bestDist) {
                    bestDist = dist;
                    bestSeg = seg;
                }
            }

            if (bestSeg != null) {
                // When the segment starts far from the label it may be a single wide segment
                // spanning the whole row (common in fixed-width payroll PDFs).
                // If the label is well to the RIGHT of the segment start, the value is buried
                // in the middle/end of the segment — use character-level extraction at labelX.
                // If the label is near or to the LEFT of the segment start, the segment likely
                // starts at the value — use extractFirstToken (the normal path).
                // Use character-level extraction when the label is far to the right of the
                // segment start AND the segment contains multiple space-separated columns.
                // The 3x multiplier avoids triggering for labels that are just slightly
                // indented relative to their value (e.g. TRABAJADOR/A at X=108 with value
                // starting at X=16) while still catching D.N.I. at X=491 with value at X=16.
                boolean labelFarRight = labelX > bestSeg.startX + COLUMN_ALIGN_THRESHOLD * 3;
                if (labelFarRight) {
                    for (float tol : new float[] {30f, COLUMN_ALIGN_THRESHOLD}) {
                        String atX = extractTextAtX(candidate.positions, labelX, tol);
                        if (atX != null) return atX;
                    }
                }
                return extractFirstToken(bestSeg.text.trim());
            }

            // No segment matched — try character-level extraction directly
            for (float tol : new float[] {30f, COLUMN_ALIGN_THRESHOLD}) {
                String atX = extractTextAtX(candidate.positions, labelX, tol);
                if (atX != null) return atX;
            }
        }
        return null;
    }

    /**
     * Return the text that appears in {@code lineText} to the right of {@code label}. First tries
     * exact substring match; falls back to normalized-position approximation.
     */
    private String textAfterLabel(String lineText, String label) {
        // 1. Exact match
        int idx = lineText.indexOf(label);
        if (idx >= 0) {
            String after = lineText.substring(idx + label.length()).trim();
            return after.isEmpty() ? null : after;
        }

        // 2. Case-insensitive match
        String lower = lineText.toLowerCase();
        String lowerLabel = label.toLowerCase();
        idx = lower.indexOf(lowerLabel);
        if (idx >= 0) {
            String after = lineText.substring(idx + label.length()).trim();
            return after.isEmpty() ? null : after;
        }

        // 3. Normalized: approximate position in original text by character-count ratio
        String normLine = normalize(lineText);
        String normLabel = normalize(label);
        int normIdx = normLine.indexOf(normLabel);
        if (normIdx < 0) return null;

        int normEnd = normIdx + normLabel.length();
        int approxEnd = (int) Math.round((double) normEnd / normLine.length() * lineText.length());
        approxEnd = Math.min(approxEnd, lineText.length());

        String after = lineText.substring(approxEnd).trim();
        return after.isEmpty() ? null : after;
    }

    /** Return the text that appears in {@code lineText} to the left of {@code label}. */
    private String textBeforeLabel(String lineText, String label) {
        int idx = lineText.indexOf(label);
        if (idx > 0) {
            String before = lineText.substring(0, idx).trim();
            return before.isEmpty() ? null : before;
        }
        String lower = lineText.toLowerCase();
        idx = lower.indexOf(label.toLowerCase());
        if (idx > 0) {
            String before = lineText.substring(0, idx).trim();
            return before.isEmpty() ? null : before;
        }
        return null;
    }

    /**
     * When a segment contains multiple consecutive spaces (3+), only the portion before the first
     * such run is returned. This handles PDFs that use spaces to visually separate columns within
     * the same text run (e.g. "LOPEZ GARCIA, IVAN 48329537M" → "LOPEZ GARCIA, IVAN").
     */
    private String extractFirstToken(String text) {
        int idx = text.indexOf("   "); // 3 consecutive spaces = column separator
        return idx > 0 ? text.substring(0, idx).trim() : text;
    }

    /**
     * Normalize text for fuzzy label matching: removes dots, colons, hyphens, slashes and
     * whitespace, lowercases. "N.I.F." → "nif", "Apellidos y Nombre:" → "apellidosynombre"
     */
    private String normalize(String text) {
        return text.replaceAll("[.:\\-/\\s]+", "").toLowerCase();
    }

    /**
     * Extract all text rows from the document. Each row corresponds to a distinct Y coordinate
     * group. Within each row, characters are split into column {@link TextSegment}s when there is a
     * significant horizontal gap (≥ {@link #COLUMN_GAP_THRESHOLD}) between them. The row also
     * stores the merged {@code fullText} of all its characters for label matching purposes.
     */
    private List<TextRow> extractRows(PDDocument document) throws IOException {
        List<TextRow> rows = new ArrayList<>();
        List<List<TextPosition>> rawLines = new ArrayList<>();
        List<TextPosition> currentLine = new ArrayList<>();

        PDFTextStripper stripper =
                new PDFTextStripper() {
                    float lastY = Float.NaN;

                    @Override
                    protected void startPage(PDPage page) throws IOException {
                        // Flush current line and reset Y on each new page
                        if (!currentLine.isEmpty()) {
                            rawLines.add(new ArrayList<>(currentLine));
                            currentLine.clear();
                        }
                        lastY = Float.NaN;
                        super.startPage(page);
                    }

                    @Override
                    protected void processTextPosition(TextPosition text) {
                        String ch = text.getUnicode();
                        if (ch == null) return;

                        float y = text.getY();
                        if (Float.isNaN(lastY) || Math.abs(y - lastY) > LINE_GAP_THRESHOLD) {
                            if (!currentLine.isEmpty()) {
                                rawLines.add(new ArrayList<>(currentLine));
                                currentLine.clear();
                            }
                            lastY = y;
                        }
                        currentLine.add(text);
                    }

                    @Override
                    public String getText(PDDocument doc) throws IOException {
                        super.getText(doc);
                        if (!currentLine.isEmpty()) {
                            rawLines.add(new ArrayList<>(currentLine));
                        }
                        return "";
                    }
                };

        stripper.setSortByPosition(true);
        stripper.getText(document);

        for (List<TextPosition> rawLine : rawLines) {
            if (rawLine.isEmpty()) continue;
            float y = rawLine.get(0).getY();

            // Build full text of the row (used for label matching)
            StringBuilder fullSb = new StringBuilder();
            for (TextPosition tp : rawLine) {
                String ch = tp.getUnicode();
                if (ch != null) fullSb.append(ch);
            }
            String fullText = fullSb.toString().trim();
            if (fullText.isBlank()) continue;

            // Split the row into column segments by significant X gaps so that when searching
            // above/below we return only the value in the aligned column, not the whole row.
            List<TextSegment> segments = new ArrayList<>();
            List<TextPosition> currentSeg = new ArrayList<>();
            for (TextPosition tp : rawLine) {
                if (!currentSeg.isEmpty()) {
                    TextPosition prev = currentSeg.get(currentSeg.size() - 1);
                    float gap = tp.getX() - (prev.getX() + prev.getWidth());
                    if (gap > COLUMN_GAP_THRESHOLD) {
                        addSegment(currentSeg, segments);
                        currentSeg.clear();
                    }
                }
                currentSeg.add(tp);
            }
            addSegment(currentSeg, segments);

            if (!segments.isEmpty()) {
                float startX = segments.get(0).startX;
                rows.add(new TextRow(fullText, startX, y, segments, new ArrayList<>(rawLine)));
            }
        }

        return rows;
    }

    /** Builds a {@link TextSegment} from a list of {@link TextPosition}s and appends it. */
    private void addSegment(List<TextPosition> positions, List<TextSegment> out) {
        if (positions.isEmpty()) return;
        StringBuilder sb = new StringBuilder();
        for (TextPosition tp : positions) {
            String ch = tp.getUnicode();
            if (ch != null) sb.append(ch);
        }
        String text = sb.toString().trim();
        if (text.isBlank()) return;
        float startX = positions.get(0).getX();
        out.add(new TextSegment(text, startX));
    }

    /** A column segment within a row: a run of characters with no large horizontal gap. */
    private record TextSegment(String text, float startX) {}

    /**
     * A horizontal row of text at a given Y coordinate. {@code fullText} is the complete merged
     * text (used for label matching). {@code segments} is the list of column segments (used for
     * value alignment when searching above/below). {@code positions} stores the raw character
     * positions so we can extract text at a specific X range even when segments are too wide.
     */
    private record TextRow(
            String fullText,
            float startX,
            float y,
            List<TextSegment> segments,
            List<TextPosition> positions) {}

    /**
     * Extracts text from raw character positions that fall within a given X range. Used when the
     * value row is a single wide segment (common in fixed-width payroll PDFs) and we need to
     * extract only the portion aligned with the label's column.
     *
     * @param positions raw character positions for the row
     * @param targetX the X coordinate of the label column
     * @param tolerance how far from targetX characters are still considered aligned
     * @return trimmed text from characters within the X range, or null if empty
     */
    private String extractTextAtX(List<TextPosition> positions, float targetX, float tolerance) {
        StringBuilder sb = new StringBuilder();
        for (TextPosition tp : positions) {
            String ch = tp.getUnicode();
            if (ch == null) continue;
            float x = tp.getX();
            if (x >= targetX - tolerance && x <= targetX + tolerance) {
                sb.append(ch);
            }
        }
        String result = sb.toString().trim();
        // Clean up: collapse multiple spaces
        result = result.replaceAll("\\s{2,}", " ").trim();
        return result.isBlank() ? null : result;
    }
}
