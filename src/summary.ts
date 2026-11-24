import type { Summary } from "./manifest.js";

export const marker = "<!-- opensnapshot -->";

/** Markdown for the job summary and the PR comment. */
export function summaryMarkdown(summary: Summary, refs: { base: string; head: string }): string {
    const { changed, new: added, unchanged, skipped, errors } = summary;
    const lines = [marker, "### OpenSnapshot", ""];
    if (!changed && !added && !errors.length) lines.push(`No visual changes. ${unchanged} item${unchanged === 1 ? "" : "s"} match the base (\`${refs.base}\`).`);
    else {
        lines.push(`Compared \`${refs.head}\` with the base \`${refs.base}\`.`, "");
        lines.push("| Changed | New | Unchanged | Skipped | Errors |", "| ---: | ---: | ---: | ---: | ---: |");
        lines.push(`| ${changed} | ${added} | ${unchanged} | ${skipped} | ${errors.length} |`);
        for (const error of errors) lines.push("", `- \`${error.id}\`: ${error.message.split("\n")[0]}`);
        lines.push("", "Open `review/index.html` from the uploaded artifact to see the expected, actual and diff images.");
    }
    return lines.join("\n") + "\n";
}
