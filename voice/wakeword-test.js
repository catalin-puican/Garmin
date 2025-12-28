import { hasWakeWord } from "./intent.js";

const tests = [
  "Ok Garmin play despacito",
  "okay garden stop",
  "Hey Carmen disconnect",
  "hello garmin", // should fail
  "play despacito" // should fail
];

for (const t of tests) {
  console.log(`Testing: "${t}"`);
  console.log("Wake word detected?", hasWakeWord(t), "\n");
}
