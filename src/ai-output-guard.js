const UNSAFE_OUTPUT_CATEGORIES = Object.freeze({
  ILLEGAL_ACTIVITY: "illegal_activity",
  SEXUAL_CONTENT: "sexual_content",
  SELF_HARM_ENCOURAGEMENT: "self_harm_encouragement",
});

const ILLEGAL_ACTIVITY_PATTERNS = [
  /(?:how to|steps to|instructions for|guide to|ways to).{0,80}(?:make a bomb|make explosives|make drugs|hack|steal|commit fraud|evade police)/i,
  /(?:make|build|buy|sell|smuggle|steal|hack|attack|evade).{0,50}(?:bomb|explosive|drugs|malware|ransomware|fraud|police)/i,
  /(?:\u7206\u5f3e|\u7206\u85ac|\u9ebb\u85ac|\u899a\u9192\u5264|\u85ac\u7269|\u6bd2\u7269|\u4e0d\u6b63\u30a2\u30af\u30bb\u30b9|\u30cf\u30c3\u30ad\u30f3\u30b0|\u30de\u30eb\u30a6\u30a7\u30a2|\u30e9\u30f3\u30b5\u30e0\u30a6\u30a7\u30a2|\u8a50\u6b3a|\u7a83\u76d7|\u5bc6\u8f38|\u72af\u7f6a|\u9055\u6cd5\u884c\u70ba).{0,60}(?:\u4f5c\u308a\u65b9|\u4f5c\u308b\u65b9\u6cd5|\u624b\u9806|\u3084\u308a\u65b9|\u65b9\u6cd5|\u6307\u5357|\u8cfc\u5165|\u8ca9\u58f2|\u5bc6\u8f38|\u76d7\u3080|\u4fb5\u5165|\u653b\u6483|\u56de\u907f|\u5b9f\u884c|\u304a\u3059\u3059\u3081|\u63a8\u5968|\u52e7\u3081|\u3059\u3079\u304d|\u3057\u308d)/i,
  /(?:\u4f5c\u308a\u65b9|\u624b\u9806|\u3084\u308a\u65b9|\u65b9\u6cd5|\u6307\u5357).{0,30}(?:\u7206\u5f3e|\u7206\u85ac|\u9ebb\u85ac|\u899a\u9192\u5264|\u4e0d\u6b63\u30a2\u30af\u30bb\u30b9|\u30cf\u30c3\u30ad\u30f3\u30b0|\u30de\u30eb\u30a6\u30a7\u30a2|\u8a50\u6b3a|\u7a83\u76d7)/i,
];

const SEXUAL_CONTENT_PATTERNS = [
  /(?:porn|pornographic|hentai|explicit sex|sexual intercourse|masturbat|ejaculat|oral sex|genitals|nude|naked)/i,
  /(?:\u30bb\u30c3\u30af\u30b9|\u6027\u4ea4|\u6027\u884c\u70ba|\u81ea\u6170|\u30aa\u30ca\u30cb\u30fc|\u30de\u30b9\u30bf\u30fc\u30d9\u30fc\u30b7\u30e7\u30f3|\u30d5\u30a7\u30e9|\u30af\u30f3\u30cb|\u5c04\u7cbe|\u7cbe\u6db2|\u5168\u88f8|\u88f8|\u9670\u830e|\u81a3|\u30dd\u30eb\u30ce|\u30a2\u30c0\u30eb\u30c8|\u30a8\u30ed)/i,
];

const SELF_HARM_ENCOURAGEMENT_PATTERNS = [
  /(?:how to|ways to|steps to|method|recommend|encourage|should|do it).{0,60}(?:suicide|self-harm|cut yourself|hang yourself|overdose)/i,
  /(?:suicide|self-harm|cut yourself|hang yourself|overdose).{0,60}(?:how to|steps|method|recommend|encourage|should|do it)/i,
  /(?:\u81ea\u6bba|\u81ea\u50b7|\u30ea\u30b9\u30c8\u30ab\u30c3\u30c8|\u9996\u3092\u540a|\u98db\u3073\u964d\u308a|\u624b\u9996\u3092\u5207|\u904e\u91cf\u670d\u85ac|\u30aa\u30fc\u30d0\u30fc\u30c9\u30fc\u30ba|OD).{0,50}(?:\u65b9\u6cd5|\u624b\u9806|\u3084\u308a\u65b9|\u3059\u308c|\u3057\u308d|\u3059\u3079\u304d|\u304a\u3059\u3059\u3081|\u63a8\u5968|\u52e7\u3081|\u4fc3\u3057|\u5b9f\u884c)/i,
  /(?:\u65b9\u6cd5|\u624b\u9806|\u3084\u308a\u65b9|\u304a\u3059\u3059\u3081|\u63a8\u5968|\u52e7\u3081|\u4fc3\u3057).{0,30}(?:\u81ea\u6bba|\u81ea\u50b7|\u30ea\u30b9\u30c8\u30ab\u30c3\u30c8|\u9996\u3092\u540a|\u98db\u3073\u964d\u308a|\u624b\u9996\u3092\u5207|\u904e\u91cf\u670d\u85ac|\u30aa\u30fc\u30d0\u30fc\u30c9\u30fc\u30ba|OD)/i,
];

class UnsafeAiOutputError extends Error {
  constructor(category, message = "AI output was blocked by the safety gate.") {
    super(message);
    this.name = "UnsafeAiOutputError";
    this.code = "UNSAFE_AI_OUTPUT";
    this.category = category;
  }
}

class AiOutputReviewError extends Error {
  constructor(message = "AI output safety review failed.") {
    super(message);
    this.name = "AiOutputReviewError";
    this.code = "AI_OUTPUT_REVIEW_FAILED";
  }
}

function moderateAiOutput(text) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) return { allowed: true, category: null };

  if (SEXUAL_CONTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { allowed: false, category: UNSAFE_OUTPUT_CATEGORIES.SEXUAL_CONTENT };
  }
  const hasSafeSelfHarmRefusal =
    /(?:\u3067\u304d\u307e\u305b\u3093|\u3057\u307e\u305b\u3093|\u52e7\u3081\u307e\u305b\u3093|\u63a8\u5968\u3057\u307e\u305b\u3093|\u6848\u5185\u3067\u304d\u307e\u305b\u3093|\u52a9\u3051\u3092\u6c42\u3081|\u76f8\u8ac7)/i.test(normalized) &&
    !/(?:\u3057\u308d|\u3059\u3079\u304d|\u304a\u3059\u3059\u3081\u3067\u3059|\u63a8\u5968\u3057\u307e\u3059|\u52e7\u3081\u307e\u3059|\u6559\u3048\u307e\u3059|\u8aac\u660e\u3057\u307e\u3059|\u5b9f\u884c\u3057\u3066)/i.test(normalized);
  if (!hasSafeSelfHarmRefusal && SELF_HARM_ENCOURAGEMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      allowed: false,
      category: UNSAFE_OUTPUT_CATEGORIES.SELF_HARM_ENCOURAGEMENT,
    };
  }
  if (ILLEGAL_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { allowed: false, category: UNSAFE_OUTPUT_CATEGORIES.ILLEGAL_ACTIVITY };
  }
  return { allowed: true, category: null };
}

function assertLocallySafeAiOutput(text) {
  const moderation = moderateAiOutput(text);
  if (!moderation.allowed) throw new UnsafeAiOutputError(moderation.category);
  return moderation;
}

export {
  AiOutputReviewError,
  UNSAFE_OUTPUT_CATEGORIES,
  UnsafeAiOutputError,
  assertLocallySafeAiOutput,
  moderateAiOutput,
};
