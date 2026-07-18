const INPUT_PAUSE_CONTROL_USER_ID = "1068329268397998161";

function canControlInputPause(userId) {
  return userId === INPUT_PAUSE_CONTROL_USER_ID;
}

class InputPauseStore {
  constructor() {
    this.paused = false;
  }

  start() {
    this.paused = true;
  }

  open() {
    this.paused = false;
  }

  isPaused() {
    return this.paused;
  }
}

export {
  INPUT_PAUSE_CONTROL_USER_ID,
  InputPauseStore,
  canControlInputPause,
};
