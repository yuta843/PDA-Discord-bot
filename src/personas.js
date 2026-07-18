const PERSONA_SWITCH_PATTERN = /^ペルソナ切り替え\s*[:：]\s*(pda_founder|danjo_towa|壇上十和)\s*$/iu;

function parsePersonaSwitchCommand(content = "") {
  if (typeof content !== "string") return null;
  const match = content.trim().match(PERSONA_SWITCH_PATTERN);
  if (!match) return null;

  const persona = match[1].toLowerCase() === "壇上十和"
    ? "danjo_towa"
    : match[1].toLowerCase();
  return { persona };
}

export { parsePersonaSwitchCommand };
