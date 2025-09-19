async function main() {
  const result = await import("./async");
  if (result.return42() !== 42)
    throw new Error("It's not 42");
}

void main();
