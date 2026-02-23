const button = document.getElementById("run-test-action");
const result = document.getElementById("result");
const deployMeta = document.getElementById("deploy-meta");

const setResult = (value) => {
  result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const loadDeployMeta = async () => {
  try {
    const response = await fetch(`/deploy-meta.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const meta = await response.json();
    const deployedAt = typeof meta.deployedAt === "string" ? meta.deployedAt : "unknown";
    const commit = typeof meta.commitSha === "string" ? meta.commitSha.slice(0, 7) : "unknown";
    deployMeta.textContent = `Deployment info: ${deployedAt} (commit ${commit})`;
  } catch {
    deployMeta.textContent = "Deployment info unavailable.";
  }
};

void loadDeployMeta();

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
