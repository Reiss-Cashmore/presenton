# Fix: Custom/Ollama LLM providers missing `tools` parameter in streaming

## Context
When using a custom LLM endpoint (e.g. ngrok URL), outline generation fails with:
```
OpenAI API error: Error code: 400 - {'error': "Cannot read properties of null (reading 'type')"}
```
The root cause is that `_stream_custom_structured` and `_stream_ollama_structured` don't accept or forward the `tools` parameter, so tools like `SearchWebTool` are silently dropped. The OPENAI/CODEX/GOOGLE/ANTHROPIC providers all pass `tools` correctly — only CUSTOM and OLLAMA are broken.

## File to modify
`servers/fastapi/services/llm_client.py`

## Changes (3 edits in one file)

### 1. Add `tools` param to `_stream_ollama_structured` (lines 2205-2221)
- Add `tools: Optional[List] = None` to the method signature
- Pass `tools=tools` to the inner `_stream_openai_structured()` call

### 2. Add `tools` param to `_stream_custom_structured` (lines 2223-2241)
- Add `tools: Optional[List] = None` to the method signature
- Pass `tools=tools` to the inner `_stream_openai_structured()` call

### 3. Pass `parsed_tools` in `stream_structured` call sites (lines 2289-2304)
- OLLAMA case (line 2290): add `tools=parsed_tools`
- CUSTOM case (line 2298): add `tools=parsed_tools`

## Verification
- Run `cd servers/fastapi && python -c "from services.llm_client import LLMClient; print('import ok')"` to confirm no syntax errors
- Test with the user's custom ngrok URL to verify outline streaming works
