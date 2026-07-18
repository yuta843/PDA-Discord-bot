const IMAGE_COMMAND_ALLOWED_USER_ID = "1068329268397998161";

function canUseImageCommand(userId) {
  return typeof userId === "string" && userId === IMAGE_COMMAND_ALLOWED_USER_ID;
}

export { IMAGE_COMMAND_ALLOWED_USER_ID, canUseImageCommand };
