// Tests run without booting the server, but config.ts is imported transitively
// by intent-classifier (and the processor). We set safe defaults so config
// validation passes when tests load that module graph.
process.env.OPENAI_API_KEY ??= "sk-test-placeholder";
process.env.DATABASE_URL ??= "postgresql://supersdr:supersdr@localhost:5432/supersdr_test";
process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "fatal";
