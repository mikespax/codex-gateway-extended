const requiredMajor = 24;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (!Number.isInteger(currentMajor) || currentMajor < requiredMajor) {
  console.error(
    `Codex Gateway requires Node.js ${requiredMajor} or newer; found ${process.versions.node}. ` +
      "Use the repository .nvmrc or install Node.js 24.",
  );
  process.exitCode = 1;
}
