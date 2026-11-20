# November 19 exploratory continuation

This is one separately authorized exploratory allocation. It never reopens an
old sequence or changes its budget, and it does not certify playing strength.
The fixed training stop is November 20 2026 14:00 UTC. Artifact verification
ends at16:00 UTC. Graceful handoff begins before the training stop.

Run the foreground driver from a clean frozen checkout using the qualified,
fully hydrated `.ai-runs` portable inventory and locked Python dependencies:

```
PYTHONPATH=tools/ai-trainer RIGHELT_TRAINING_DEVICE=mps python -m righelt_training.exploratory_window --plan PRIVATE_PLAN.json --gate-report PRIVATE_GATE.json
```

The schema1 plan has kind `attention-exploratory-window`, lane `A` or `B`, an
explicit `authorizationReference`, committed `sourceRevision`, distinct `seed`,
stage `initial`, contained relative `runDir`, `trainingStopWall:1795183200`,
`artifactDeadlineWall:1795190400`, and the unchanged native manifest. The native
manifest binds attention48x2, `executionBackend:mps` (or CUDA for hosted work),
the qualified guards, original root-search recipe and warm-start checkpoint.
`checkpoint`, `executionRecipe`, `trainingRecipe`, and `portableClosure` each
contain a path and byte SHA256. Use relocated relative paths or inventory
reference aliases, never an unmapped historical path. `activityFile` is optional.

Generate the execution recipe from this exact committed source with
`execution_recipe.record(...,mode='attention-incumbent-continuation',
training_recipe=recipe_binding(),attention_method=qualified_method)` and the
qualified data commitment. The trainingRecipe file contains that unchanged
root-search recipe. Preserve the teacher, normal/contact curriculum, losses,
observed-future targets and masks. No policy-refresh input is permitted.

The source-bound initial gate retains core/trainer/replay/export proof and its
dependency inventory. Historical overnight100-terminal and predecessor-phase
requirements do not apply to this distinct entry. Fresh-policy acceptance
requires real replay-accepted decisions sampled in finite nonzero updates and
retained in the selected checkpoint. Valid truncation supplies no terminal value.
Copied trajectories, masked fallback and unsampled rows cannot qualify.

The native supervisor owns all child sessions. The driver holds its allocation
lock, verifies cleanup before recovery, preserves consumed job claims, and
allows at most two durably consumed resource resumes. Resource waits have a
cumulative two-hour repair ceiling; healthy training does not consume it.
Unclassified interruptions, telemetry failures, corruption and incorrect
targets stop the lane. A checkpoint alone never authorizes restarting a failure.

Use a persistent managed session and reattach after the initial tool call to
verify driver/parent ownership and actual MPS/checkpoint progress. The driver
owns a task-lifetime AC awake assertion. It requires no interactive tools or
credentials during local training. Screen-lock readiness is not a promise of
survival through sleep, logout, reboot or termination of its owning application.
The operator's reviewed one-shot user launchd fallback runs this same foreground
driver if persistent-session readiness fails before training.

`candidate-report.json`, `model.onnx`, numeric diagnostics and the complete native
checkpoint/replay bundle remain local. Browser acceptance and promotion are
separate. Keep the incumbent default until Kenan chooses by playing. No provider
allocation, controller activation, app deployment or schedule is performed here.
