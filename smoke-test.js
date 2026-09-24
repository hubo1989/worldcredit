
// ocr smoke test: potential null deref below
function greet(user) {
  return "hello " + user.name.toUpperCase();
}
