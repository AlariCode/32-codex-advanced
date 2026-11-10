// Only the fixed Compose test service is reachable by these maintenance commands.
import { spawn } from "node:child_process";
import { open, mkdir, chmod } from "node:fs/promises";
import { resolve } from "node:path";

export async function archiveRestore(root, schema, database) {
  const expected = new URL(
    "postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable",
  );
  if (database.href !== expected.href || !/^e2e_[a-z0-9_]+$/.test(schema))
    throw new Error(
      "Backup harness requires the unmodified Compose test database URL",
    );
  const target = `archive_restore_${process.pid}_${Date.now()}`;
  const dir = resolve(root, "tmp/backup-restore", schema);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const compose = [
    "compose",
    "-f",
    "compose.test.yaml",
    "exec",
    "-T",
    "postgres-test",
  ];
  async function command(args, input = "ignore", output = "inherit") {
    await new Promise((resolve, reject) => {
      const child = spawn("docker", [...compose, ...args], {
        cwd: root,
        stdio: [input, output, "inherit"],
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Archive maintenance exited ${code}`)),
      );
    });
  }
  let targetCreated = false;
  const cleanup = () =>
    targetCreated
      ? command([
          "dropdb",
          "-U",
          "linkbook_test",
          "--if-exists",
          "--force",
          target,
        ])
      : Promise.resolve();
  return {
    dir,
    cleanup,
    async restore() {
      const dump = await open(resolve(dir, "archive.dump"), "wx", 0o600);
      try {
        await command(
          [
            "pg_dump",
            "-U",
            "linkbook_test",
            "-d",
            "linkbook_test",
            "--format=custom",
            "--schema",
            schema,
            "--no-owner",
            "--no-acl",
          ],
          "ignore",
          dump.fd,
        );
      } finally {
        await dump.close();
      }
      await command([
        "createdb",
        "-U",
        "linkbook_test",
        "--template=template0",
        target,
      ]);
      targetCreated = true;
      const input = await open(resolve(dir, "archive.dump"), "r");
      try {
        await command(
          [
            "pg_restore",
            "-U",
            "linkbook_test",
            "-d",
            target,
            "--exit-on-error",
            "--single-transaction",
            "--no-owner",
            "--no-acl",
          ],
          input.fd,
        );
      } finally {
        await input.close();
      }
      const restored = new URL(database);
      restored.pathname = `/${target}`;
      restored.searchParams.set("search_path", schema);
      return restored.href;
    },
  };
}
