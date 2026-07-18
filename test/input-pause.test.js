import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_PAUSE_CONTROL_USER_ID,
  InputPauseStore,
  canControlInputPause,
} from "../src/input-pause.js";

test("allows input-pause control only for the configured user", () => {
  assert.equal(canControlInputPause(INPUT_PAUSE_CONTROL_USER_ID), true);
  assert.equal(canControlInputPause("other-user"), false);
  assert.equal(canControlInputPause(1068329268397998161), false);
});

test("keeps automatic AI replies paused until /open clears it", () => {
  const store = new InputPauseStore();
  store.start();
  assert.equal(store.isPaused(), true);
  assert.equal(store.isPaused(), true);
});

test("resumes automatic AI replies immediately", () => {
  const store = new InputPauseStore();
  store.start();
  store.open();
  assert.equal(store.isPaused(), false);
});
