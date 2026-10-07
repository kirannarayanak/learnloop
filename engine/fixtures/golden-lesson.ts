/**
 * The golden lesson.
 *
 * Hand-authored, and it has two jobs:
 *
 *  1. It is the **quality target** the generator is aimed at. "Make a rich lesson" is not
 *     a specification; this is. When the real model adapters land, the graph and draft
 *     prompts are written to produce something shaped like this.
 *
 *  2. It is the **first item in the eval set** (docs/09-model-strategy.md). Generated
 *     lessons get compared against it structurally — does the retrieval land in the
 *     middle, does the narration avoid restating the screen, is there a constructive
 *     block — long before anyone judges the prose.
 *
 * Note what the narration does throughout: it never reads the key points aloud. The eye
 * gets short labels and a diagram; the ear gets the explanation. That separation is the
 * whole point (docs/11-lesson-design.md).
 */

import type { LessonBlock } from '../stages/blocks.ts';

export const GOLDEN_SKILL_SLUG = 'call-stack';

export const goldenLessonBlocks: LessonBlock[] = [
  {
    type: 'pretrain',
    terms: [
      { term: 'Tool call', gloss: 'The model asking you to run something, with arguments' },
      { term: 'Tool result', gloss: 'What you send back after running it' },
      { term: 'Stop reason', gloss: 'Why the model stopped talking this turn' },
    ],
    narration:
      'Three words will come up constantly, so let us get them out of the way first. When a model wants something done, it does not run it. It asks you to, and that request is a tool call. You run it and hand back what happened, which is the tool result. And every time the model stops producing output, it tells you why it stopped. Keep that third one in mind, because it turns out to be the thing that controls the whole loop.',
  },

  {
    type: 'diagram',
    caption: 'One turn of the loop',
    nodes: [
      { id: 'you', label: 'Your code', x: 14, y: 50 },
      { id: 'model', label: 'Model', x: 48, y: 50 },
      { id: 'tool', label: 'Your tool', x: 82, y: 18, note: 'runs on your machine' },
      { id: 'done', label: 'Answer', x: 82, y: 82 },
    ],
    edges: [
      { from: 'you', to: 'model', label: 'messages' },
      { from: 'model', to: 'tool', label: 'tool_use' },
      { from: 'tool', to: 'model', label: 'tool_result', back: true },
      { from: 'model', to: 'done', label: 'end_turn' },
    ],
    steps: [
      {
        label: 'Send the conversation',
        highlight: ['you', 'model'],
        narration:
          'You send the whole conversation so far. Not a diff, not just the newest message. The model holds no memory between calls, so whatever you leave out simply did not happen as far as it is concerned.',
      },
      {
        label: 'It asks for a tool',
        highlight: ['model', 'tool'],
        narration:
          'Instead of answering, it comes back asking for something to be run. Notice the direction here. The model never reaches out and touches anything itself. It is sealed off, and it describes what it wants done. Your code is the only thing with hands.',
      },
      {
        label: 'You run it, you answer',
        highlight: ['tool', 'model'],
        narration:
          'You execute it and append the outcome to the conversation, then send the whole thing again. This is the step people skip, and skipping it is what produces an agent that asks for the same thing over and over, forever.',
      },
      {
        label: 'Eventually it just answers',
        highlight: ['model', 'done'],
        narration:
          'At some point it has what it needs and replies normally. That is the exit. Nothing else ends the loop, which is why the next few minutes are all about recognising that moment correctly.',
      },
    ],
  },

  {
    type: 'predict',
    question:
      'You run the tool, but you forget to append the result and just send the same messages again. What happens?',
    options: [
      'The model errors, telling you a result is missing',
      'The model asks for the exact same tool again',
      'The model gives up and answers without it',
    ],
    correctIndex: 1,
    reveal:
      'It asks again — and will keep asking. From the model\'s side the conversation is unchanged, so the same input produces the same request. There is no error because nothing is actually wrong: you sent a valid conversation in which it has asked for something and nobody replied. This is the single most common way a first agent loop ends up spinning. It is not a bug in the model, it is a missing append in your code.',
    narration:
      'Before you read the options, actually decide. Being wrong here is useful, so commit to one.',
  },

  {
    type: 'concept',
    heading: 'The loop ends on stop_reason, not on vibes',
    keyPoints: [
      'stop_reason: "tool_use" → keep looping',
      'stop_reason: "end_turn" → you are done',
      'Never guess from the text content',
    ],
    narration:
      'There is a tempting shortcut here, which is to look at whether the response contains any text and decide from that. Do not. A model can write a sentence explaining what it is about to do and then ask for a tool in the very same response, so text being present tells you nothing. The stop reason is an explicit signal and it is the only thing you should branch on. Code that inspects the content to decide whether to continue will work on your examples and then break on the first response that happens to be chatty.',
  },

  {
    type: 'check',
    question:
      'A response contains a paragraph of text AND a tool call. The stop reason is "tool_use". What should your loop do?',
    options: [
      'Show the text and stop — it answered',
      'Run the tool, append the result, and continue',
      'Discard the text and run the tool silently',
    ],
    correctIndex: 1,
    explanation:
      'Continue. Text and a tool call routinely arrive together — the model narrating its next move does not mean it is finished. Showing the text to the learner is fine and often nice, but the loop keeps going because the stop reason said so. Option three throws away something the user might want to see for no benefit.',
    targetsMisconception: 'Text in the response means the model has finished.',
  },

  {
    type: 'worked_example',
    goal: 'Trace a loop that needs two tools before it can answer',
    steps: [
      {
        show: 'messages = [user: "What is the weather in Tokyo in Fahrenheit?"]',
        explain: 'Starting point. One user message, nothing else.',
      },
      {
        show: '→ model responds: tool_use get_weather(city="Tokyo"), stop_reason="tool_use"',
        explain: 'It needs data it does not have. Note the stop reason — this is the continue signal.',
      },
      {
        show: 'messages += [assistant: that response, user: tool_result "18°C"]',
        explain:
          'Both halves get appended: what the model said AND your result. Appending only the result loses the request it answers, and the conversation stops making sense.',
      },
      {
        show: '→ model responds: tool_use convert_units(18, "C", "F"), stop_reason="tool_use"',
        explain: 'A second tool, chosen because of what the first one returned. This is the part you cannot hard-code.',
      },
      {
        show: '???',
        explain:
          'Same move as before: append the assistant message and the tool result together, then send everything again.',
        faded: true,
        options: [
          'Append only the tool_result and resend',
          'Append the assistant message AND the tool_result, then resend',
          'Start a fresh conversation with just the converted value',
        ],
        correctIndex: 1,
      },
      {
        show: '→ model responds: "It is 64°F in Tokyo.", stop_reason="end_turn"',
        explain: 'It has everything it needs, so it answers. end_turn — the loop exits here.',
      },
    ],
  },

  {
    type: 'check',
    question:
      'One response comes back with THREE tool calls at once. How do you send the results?',
    options: [
      'Three separate messages, one result each',
      'One message containing all three results',
      'One at a time, re-calling the model after each',
    ],
    correctIndex: 1,
    explanation:
      'All three go in a single message. Splitting them across messages produces a conversation where some calls appear unanswered, and it quietly trains the model to stop making parallel calls at all — so your agent gets slower over a long conversation and you will struggle to work out why. Run them concurrently, collect everything, send one message.',
    targetsMisconception: 'Each tool result needs its own message.',
  },

  {
    type: 'explain_back',
    prompt:
      'A colleague says: "My agent keeps calling the same tool in a loop and never finishes." In your own words, what are the two things you would check first?',
    modelAnswer:
      'First, whether the tool result is actually being appended to the conversation before the next call — if it is not, the model sees the identical input every time and makes the identical request. Second, whether the loop is branching on stop_reason rather than on the presence of text, since a chatty response that also contains a tool call will be mistaken for a final answer, or a tool call will be missed entirely. Both are failures in the surrounding code, not in the model.',
    mustMention: [
      'The tool result must be appended to the conversation',
      'The loop should branch on stop_reason, not on text content',
    ],
  },

  {
    type: 'recap',
    points: [
      'Resend the whole conversation — the model remembers nothing',
      'Append the assistant message AND the result, together',
      'Branch on stop_reason only',
      'Parallel calls → one message with every result',
    ],
    narration:
      'The thing worth carrying away is that almost everything which goes wrong in one of these loops goes wrong in your code rather than in the model. It is sealed off, it asks, you act, you report back accurately. Hold that shape in your head and the failures become easy to spot: either you did not report back, or you misread the signal telling you to keep going.',
  },
];

/** Citations for the golden lesson. Provenance does not lapse because the format got richer. */
export const goldenCitations = [
  { quote: 'The loop continues while stop_reason is "tool_use" and ends on "end_turn".' },
  {
    quote:
      'Return all tool_result blocks in a single user message; splitting them across messages discourages parallel tool use.',
  },
];
