const button = document.getElementById("run-test-action");
const result = document.getElementById("result");

const setResult = (value) => {
  result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

button.addEventListener("click", async () => {
  button.disabled = true;
  setResult("Sending request...");

  try {
    const response = await fetch("/api/test-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Run Test Action clicked" })
    });
    const body = await response.json();
    setResult(body);
  } catch (error) {
    setResult({
      ok: false,
      error: "request_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  } finally {
    button.disabled = false;
  }
});
