import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

test("static files reject traversal outside the configured root", async () => {
  const base = await mkdtemp(join(tmpdir(), "forum-static-security-"));
  const root = join(base, "public");
  const privateFile = join(base, "private.txt");
  await mkdir(root);
  await writeFile(join(root, "public.txt"), "public-content");
  await writeFile(privateFile, "private-content");

  const app = Fastify();
  try {
    await app.register(fastifyStatic, { root, prefix: "/uploads/" });

    const publicResponse = await app.inject({
      method: "GET",
      url: "/uploads/public.txt",
    });
    assert.equal(publicResponse.statusCode, 200);
    assert.equal(publicResponse.body, "public-content");

    for (const url of [
      "/uploads/../private.txt",
      "/uploads/%2e%2e/private.txt",
      "/uploads/%2e%2e%2fprivate.txt",
      "/uploads/%2e%2e%5cprivate.txt",
      "/uploads/%252e%252e%252fprivate.txt",
    ]) {
      const response = await app.inject({ method: "GET", url });
      assert.ok([403, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
      assert.notEqual(response.body, "private-content", url);
    }
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
