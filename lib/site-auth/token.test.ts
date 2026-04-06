import test from "node:test"
import assert from "node:assert/strict"

import { createSessionToken, verifySessionToken } from "./token"

test("session token verifies until exp", async () => {
  const secret = "test-secret-at-least-16-chars"
  const token = await createSessionToken(secret)
  assert.equal(await verifySessionToken(token, secret), true)
  assert.equal(await verifySessionToken(token, "wrong"), false)
  assert.equal(await verifySessionToken("nope", secret), false)
})
