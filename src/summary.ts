import type { Summary } from "./manifest.js";

/** Hidden first line of the comment. The Action finds its own comment by it, so each project name gets one comment. */
export const markerFor = (name?: string) => `<!-- opensnapshot${name ? `:${name.replace(/[^\w.]+/g, "_")}` : ""} -->`;

/** Markdown for the job summary and the PR comment. */
export function summaryMarkdown(summary: Summary, refs: { base: string; head: string; name?: string }): string {
    const { changed, new: added, unchanged, skipped, errors, notAffected = 0 } = summary;
    const left = notAffected ? ` ${notAffected} stor${notAffected === 1 ? "y is" : "ies are"} not affected by the change.` : "";
    const lines = [markerFor(refs.name), refs.name ? `### OpenSnapshot: ${refs.name}` : "### OpenSnapshot", ""];
    if (!changed && !added && !errors.length)
        lines.push(unchanged ? `No visual changes. ${unchanged} item${unchanged === 1 ? "" : "s"} match the base (\`${refs.base}\`).${left}` : `No visual changes against \`${refs.base}\`.${left}`);
    else {
        lines.push(`Compared \`${refs.head}\` with the base \`${refs.base}\`.`, "");
        lines.push("| Changed | New | Unchanged | Skipped | Errors |", "| ---: | ---: | ---: | ---: | ---: |");
        lines.push(`| ${changed} | ${added} | ${unchanged} | ${skipped} | ${errors.length} |`);
        if (left) lines.push("", left.trim());
        for (const error of errors) lines.push("", `- \`${error.id}\`: ${error.message.split("\n")[0]}`);
        lines.push("", "Open `review/index.html` from the uploaded artifact to see the expected, actual and diff images.");
    }
    return lines.join("\n") + "\n";
}
