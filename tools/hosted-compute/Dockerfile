# Build from prepare-context.mjs output, never a worktree .git pointer.
# Pin both base-image digests in the reviewed build command before the paid pilot.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.14-slim-bookworm
FROM ${NODE_IMAGE} AS node
FROM ${PYTHON_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends git libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.15.9
WORKDIR /workspace/righelt
COPY . .
ARG SOURCE_REVISION
ENV SOURCE_REVISION=${SOURCE_REVISION}
RUN node tools/hosted-compute/image-identity.mjs && pnpm install --frozen-lockfile
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN python -m venv tools/ai-trainer/.venv \
    && tools/ai-trainer/.venv/bin/python -m pip install torch==2.14.1 --index-url ${TORCH_INDEX} \
    && tools/ai-trainer/.venv/bin/python -m pip install -r tools/ai-trainer/requirements.lock
ENV PATH=/workspace/righelt/tools/ai-trainer/.venv/bin:$PATH
ENV PYTHONPATH=tools/ai-trainer
CMD ["node", "tools/hosted-compute/worker.mjs"]
