const PERSONA_SWITCH_PATTERN = /^ペルソナ切り替え\s*[:：]\s*pda_founder\s*$/iu;

function parsePersonaSwitchCommand(content = "") {
  if (typeof content !== "string") return null;
  if (!PERSONA_SWITCH_PATTERN.test(content.trim())) return null;

  return { persona: "pda_founder" };
}

export { parsePersonaSwitchCommand };
