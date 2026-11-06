import type { ThreadEvent } from "@openai/codex-sdk";

export function compact(text: string, length = 140) {
  const line = text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

export function logEvent(event: ThreadEvent, log = console.log) {
  if (
    event.type === "item.started" &&
    event.item.type === "command_execution"
  ) {
    log(`  $ ${compact(event.item.command)}`);
  }
  if (event.type !== "item.completed") return;
  const item = event.item;
  switch (item.type) {
    case "command_execution":
      log(
        `  ${item.exit_code === 0 ? "✓" : "✗"} exit ${item.exit_code ?? "?"}${item.exit_code === 0 ? "" : ` · ${compact(item.aggregated_output)}`}`,
      );
      break;
    case "file_change":
      log(
        `  ${item.status === "completed" ? "✓" : "✗"} файлы: ${compact(item.changes.map((change) => change.path).join(", "))}`,
      );
      break;
    case "agent_message":
      log(`  → ${compact(item.text, 240)}`);
      break;
    case "mcp_tool_call":
      log(`  · ${compact(`${item.server}/${item.tool}`)}: ${item.status}`);
      break;
    case "error":
      log(`  ! ${compact(item.message)}`);
      break;
  }
}
