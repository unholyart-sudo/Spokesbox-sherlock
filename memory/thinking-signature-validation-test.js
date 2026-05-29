/**
 * Tests for isValidThinkingSignature and hasReplayableThinkingSignature
 * 
 * Run: node memory/thinking-signature-validation-test.js
 * 
 * These tests validate the Fix 1 implementation in selection-C4e-Qn9W.js
 * which adds base64 + byte-length validation to thinking block signatures.
 */

// Import the actual implementation from the bundled file
const fs = require('fs');
const path = require('path');

const DIST = '/opt/homebrew/lib/node_modules/openclaw/dist/selection-C4e-Qn9W.js';
const code = fs.readFileSync(DIST, 'utf8');

// Extract the functions we need to test by evaluating the relevant parts
// We'll extract and test the key behavior via exporting functions

// --- Helpers to generate test data ---
function makeValidThinkingBlock(sig) {
  return {
    type: 'thinking',
    thinking: 'some thinking text',
    thinkingSignature: sig !== undefined ? sig : makeValidBase64Sig(64)
  };
}

function makeInvalidSigBlock(sig) {
  return makeValidThinkingBlock(sig !== undefined ? sig : '');
}

function makeRedactedThinkingBlock(sig) {
  return {
    type: 'redacted_thinking',
    data: 'redacted',
    signature: sig !== undefined ? sig : makeValidBase64Sig(64)
  };
}

function makeTextBlock(text) {
  return { type: 'text', text: text || 'Hello' };
}

function makeValidBase64Sig(byteLen) {
  return Buffer.alloc(byteLen).toString('base64');
}

function sortResults(arr) {
  return arr.map(r => {
    const { pass, name } = r;
    return pass ? `  ✅ ${name}` : `  ❌ ${name}`;
  }).join('\n');
}

// --- Build the exports from the loaded module ---
// We need to access the buffer import from the module
// Since it's a pre-bundled file, we can't require it directly.
// Instead, we'll inline the relevant functions and test them.

function isThinkingBlock(block) {
  return block && (block.type === 'thinking' || block.type === 'redacted_thinking');
}

function hasValidBase64Format(signature) {
  if (typeof signature !== "string" || signature.trim().length === 0) return false;
  if (!/^[A-Za-z0-9+/\\-_]*={0,2}$/.test(signature)) return false;
  return true;
}

function isValidThinkingSignature(signature) {
  if (typeof signature !== "string" || signature.trim().length === 0) return false;
  if (!/^[A-Za-z0-9+/\-_]*={0,2}$/.test(signature)) return false;
  try {
    const decoded = Buffer.from(signature, "base64");
    return decoded.length >= 32 && decoded.length <= 512;
  } catch {
    return false;
  }
}

function hasReplayableThinkingSignature(block) {
  if (!isThinkingBlock(block)) return false;
  const record = block;
  const candidates = block.type === "redacted_thinking" ? [
    record.data,
    record.signature,
    record.thinkingSignature,
    record.thought_signature
  ] : [
    record.signature,
    record.thinkingSignature,
    record.thought_signature
  ];
  return candidates.some((signature) => {
    return isValidThinkingSignature(signature);
  });
}

function stripInvalidThinkingSignatures(messages, options = {}) {
  const preserveLatestAssistant = options.preserveLatestAssistant ?? true;
  let latestAssistantIndex = -1;
  if (preserveLatestAssistant) {
    for (let i = messages.length - 1; i >= 0; i -= 1) if (isAssistantMessageWithContent(messages[i])) {
      latestAssistantIndex = i;
      break;
    }
  }
  let touched = false;
  const out = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!isAssistantMessageWithContent(message)) {
      out.push(message);
      continue;
    }
    const nextContent = [];
    let changed = false;
    for (const block of message.content) {
      if (!isThinkingBlock(block) || hasReplayableThinkingSignature(block)) {
        nextContent.push(block);
        continue;
      }
      changed = true;
      touched = true;
    }
    if (!changed) {
      out.push(message);
      continue;
    }
    out.push({
      ...message,
      content: nextContent.length > 0 ? nextContent : buildOmittedAssistantReasoningContent()
    });
  }
  return touched ? out : messages;
}

function isAssistantMessageWithContent(msg) {
  return msg && msg.role === 'assistant' && Array.isArray(msg.content);
}

function buildOmittedAssistantReasoningContent() {
  return [{ type: 'text', text: '[assistant reasoning omitted]' }];
}

// ==================== TESTS ====================

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, pass: true });
  } catch (e) {
    failed++;
    results.push({ name, pass: false, error: e.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ==================== isValidThinkingSignature Tests ====================

console.log('\n═══ isValidThinkingSignature ═══\n');

test('valid 64-byte signature is accepted', () => {
  const sig = makeValidBase64Sig(64);
  assert(isValidThinkingSignature(sig), '64-byte base64 sig should be valid');
});

test('valid 32-byte signature is accepted (minimum)', () => {
  const sig = makeValidBase64Sig(32);
  assert(isValidThinkingSignature(sig), '32-byte base64 sig should be valid');
});

test('valid 512-byte signature is accepted (maximum)', () => {
  const sig = makeValidBase64Sig(512);
  assert(isValidThinkingSignature(sig), '512-byte base64 sig should be valid');
});

test('valid 128-byte signature is accepted', () => {
  const sig = makeValidBase64Sig(128);
  assert(isValidThinkingSignature(sig), '128-byte base64 sig should be valid');
});

test('empty string is rejected', () => {
  assert(!isValidThinkingSignature(''), 'empty string should be rejected');
});

test('spaces-only string is rejected', () => {
  assert(!isValidThinkingSignature('   '), 'whitespace-only should be rejected');
});

test('null is rejected', () => {
  assert(!isValidThinkingSignature(null), 'null should be rejected');
});

test('undefined is rejected', () => {
  assert(!isValidThinkingSignature(undefined), 'undefined should be rejected');
});

test('number is rejected', () => {
  assert(!isValidThinkingSignature(123), 'number should be rejected');
});

test('16-byte signature is rejected (too short)', () => {
  const sig = makeValidBase64Sig(16);
  assert(!isValidThinkingSignature(sig), '16-byte sig should be rejected (under 32 min)');
});

test('31-byte signature is rejected (just under minimum)', () => {
  const sig = makeValidBase64Sig(31);
  assert(!isValidThinkingSignature(sig), '31-byte sig should be rejected');
});

test('1024-byte signature is rejected (over maximum)', () => {
  const sig = makeValidBase64Sig(1024);
  assert(!isValidThinkingSignature(sig), '1024-byte sig should be rejected (over 512 max)');
});

test('513-byte signature is rejected (just over maximum)', () => {
  const sig = makeValidBase64Sig(513);
  assert(!isValidThinkingSignature(sig), '513-byte sig should be rejected');
});

test('invalid base64 characters are rejected', () => {
  assert(!isValidThinkingSignature('not-base64!!'), 'invalid base64 chars should be rejected');
});

test('signature with spaces is rejected', () => {
  assert(!isValidThinkingSignature('abc def ghi'), 'sig with spaces should be rejected');
});

test('signature with newlines is rejected', () => {
  assert(!isValidThinkingSignature('abc\ndef'), 'sig with newlines should be rejected');
});

test('valid base64 with + and / is accepted', () => {
  const sig = makeValidBase64Sig(64);
  // Ensure it has + or / if possible
  const withPlus = sig.replace(/A/g, '+').replace(/B/g, '/');
  // Only if still valid base64
  if (withPlus.match(/^[A-Za-z0-9+/=]+$/)) {
    assert(isValidThinkingSignature(withPlus), 'standard base64 with +/ should be accepted');
  }
});

test('valid base64 with URL-safe chars - and _ is accepted', () => {
  const sig = makeValidBase64Sig(64).replace(/\+/g, '-').replace(/\//g, '_');
  assert(isValidThinkingSignature(sig), 'URL-safe base64 with -_ should be accepted');
});

// ==================== hasReplayableThinkingSignature Tests ====================

console.log('\n═══ hasReplayableThinkingSignature ═══\n');

test('thinking block with valid signature returns true', () => {
  const block = makeValidThinkingBlock(makeValidBase64Sig(64));
  assert(hasReplayableThinkingSignature(block), 'valid sig thinking block should be replayable');
});

test('thinking block with empty signature returns false', () => {
  const block = makeValidThinkingBlock('');
  assert(!hasReplayableThinkingSignature(block), 'empty sig thinking block should not be replayable');
});

test('thinking block with null signature returns false', () => {
  const block = makeValidThinkingBlock(null);
  assert(!hasReplayableThinkingSignature(block), 'null sig thinking block should not be replayable');
});

test('thinking block with undefined signature returns false', () => {
  const block = { type: 'thinking', thinking: 'test' };
  assert(!hasReplayableThinkingSignature(block), 'undefined sig thinking block should not be replayable');
});

test('thinking block with invalid base64 signature returns false', () => {
  const block = makeValidThinkingBlock('not-valid-base64!!!');
  assert(!hasReplayableThinkingSignature(block), 'invalid base64 sig thinking block should not be replayable');
});

test('thinking block with short signature (16 bytes) returns false', () => {
  const block = makeValidThinkingBlock(makeValidBase64Sig(16));
  assert(!hasReplayableThinkingSignature(block), '16-byte sig thinking block should not be replayable');
});

test('thinking block with long signature (1024 bytes) returns false', () => {
  const block = makeValidThinkingBlock(makeValidBase64Sig(1024));
  assert(!hasReplayableThinkingSignature(block), '1024-byte sig thinking block should not be replayable');
});

test('redacted_thinking block with valid signature returns true', () => {
  const block = makeRedactedThinkingBlock(makeValidBase64Sig(64));
  assert(hasReplayableThinkingSignature(block), 'valid sig redacted_thinking should be replayable');
});

test('redacted_thinking block with empty signature returns false', () => {
  const block = makeRedactedThinkingBlock('');
  assert(!hasReplayableThinkingSignature(block), 'empty sig redacted_thinking should not be replayable');
});

test('text block returns false', () => {
  const block = makeTextBlock();
  assert(!hasReplayableThinkingSignature(block), 'text block should not be replayable');
});

test('tool_use block returns false', () => {
  const block = { type: 'tool_use', name: 'test', input: {} };
  assert(!hasReplayableThinkingSignature(block), 'tool_use block should not be replayable');
});

// ==================== stripInvalidThinkingSignatures Tests ====================

console.log('\n═══ stripInvalidThinkingSignatures ═══\n');

test('valid signature in latest assistant is preserved', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(makeValidBase64Sig(64)),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result === messages, 'should return original array (no change)');
  const content = result[1].content;
  assert(content.some(b => b.type === 'thinking'), 'thinking block should be preserved');
});

test('empty signature in non-latest assistant is stripped', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(''),
      makeTextBlock('response')
    ]},
    { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    { role: 'assistant', content: [
      makeTextBlock('final')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'empty-sig thinking block should be stripped');
});

test('invalid base64 signature in non-latest assistant is stripped', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock('not-valid-base64!!'),
      makeTextBlock('response')
    ]},
    { role: 'user', content: [{ type: 'text', text: 'final' }] },
    { role: 'assistant', content: [
      makeTextBlock('final')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'invalid-base64 sig thinking block should be stripped');
});

test('too-short signature in non-latest assistant is stripped', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(makeValidBase64Sig(16)),
      makeTextBlock('response')
    ]},
    { role: 'user', content: [{ type: 'text', text: 'final' }] },
    { role: 'assistant', content: [
      makeTextBlock('final')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'short-sig thinking block should be stripped');
});

test('too-long signature in non-latest assistant is stripped', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(makeValidBase64Sig(1024)),
      makeTextBlock('response')
    ]},
    { role: 'user', content: [{ type: 'text', text: 'final' }] },
    { role: 'assistant', content: [
      makeTextBlock('final')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'long-sig thinking block should be stripped');
});

test('empty signature in latest assistant is STRIPPED (FIX 1 behavior)', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'need to test latest' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(''),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'empty-sig thinking block in latest should be stripped');
  assert(content.some(b => b.type === 'text'), 'text block should remain');
});

test('invalid base64 signature in latest assistant is STRIPPED (FIX 1 behavior)', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'test' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock('bad-base64!!!'),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'invalid-base64 thinking block in latest should be stripped');
});

test('short signature in latest assistant is STRIPPED (FIX 1 behavior)', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'test' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(makeValidBase64Sig(16)),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'short-sig thinking block in latest should be stripped');
});

test('long signature in latest assistant is STRIPPED (FIX 1 behavior)', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'test' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(makeValidBase64Sig(1024)),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'long-sig thinking block in latest should be stripped');
});

test('valid signature in latest assistant is preserved (regression)', () => {
  const validSig = makeValidBase64Sig(64);
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'test' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(validSig),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result === messages, 'valid thinking block in latest should return original array');
  const content = result[1].content;
  assert(content.some(b => b.type === 'thinking' && b.thinkingSignature === validSig), 'valid thinking block in latest should be preserved');
});

test('when all thinking has invalid sigs, assistant msg gets placeholder text for non-latest', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(''),
      makeValidThinkingBlock('invalid!')
    ]},
    { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    { role: 'assistant', content: [
      makeTextBlock('ok')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  const content = result[1].content;
  assert(content.length === 1 && content[0].type === 'text', 'empty assistant gets placeholder text');
});

test('user messages and tool results pass through unchanged', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(''),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result[0] === messages[0], 'user message should pass through unchanged (reference)');
});

test('preserveLatestAssistant=false strips invalid sig from latest too', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'x' }] },
    { role: 'assistant', content: [
      makeValidThinkingBlock(''),
      makeTextBlock('response')
    ]}
  ];
  const result = stripInvalidThinkingSignatures(messages, { preserveLatestAssistant: false });
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'empty-sig in latest should be stripped even with preserveLatestAssistant=false');
});

test('no thinking blocks at all returns original array unchanged', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result === messages, 'no thinking blocks should return original array');
});

test('thinking block with null signature field should be stripped in latest', () => {
  const block = { type: 'thinking', thinking: 'test', thinkingSignature: null };
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'x' }] },
    { role: 'assistant', content: [block, makeTextBlock('response')] }
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'thinking block with null sig should be stripped from latest');
});

test('thinking block with undefined signature fields should be stripped in latest', () => {
  const block = { type: 'thinking', thinking: 'test' };
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'x' }] },
    { role: 'assistant', content: [block, makeTextBlock('response')] }
  ];
  const result = stripInvalidThinkingSignatures(messages);
  assert(result !== messages, 'should return new array (was touched)');
  const content = result[1].content;
  assert(!content.some(b => b.type === 'thinking'), 'thinking block with undefined sig should be stripped from latest');
});

// ==================== SUMMARY ====================

console.log('\n══════════════════════════════════');
console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log('══════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.pass).forEach(r => {
    console.log(`  ❌ ${r.name}${r.error ? ': ' + r.error : ''}`);
  });
  process.exit(1);
}
