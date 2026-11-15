# Build ONLY from the audited prepare-context.mjs export. Both base images must
# be digest-pinned in its reviewed build configuration. No default floating tag.
ARG NODE_IMAGE
ARG PYTHON_IMAGE
FROM ${NODE_IMAGE} AS node
FROM ${PYTHON_IMAGE} AS cuda-dependencies
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.15.9
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
ARG TORCH_VERSION=2.14.1
RUN python -m venv /opt/righelt-python \
    && /opt/righelt-python/bin/python -m pip install --only-binary=:all: torch==${TORCH_VERSION} --index-url ${TORCH_INDEX}
# This no-GPU build target checks requested Linux/Python CUDA wheel existence
# and import. It proves wheel compatibility, never GPU availability.
FROM cuda-dependencies AS cuda-wheel-check
ARG TORCH_VERSION=2.14.1
RUN /opt/righelt-python/bin/python -c "import platform,torch; assert platform.machine()=='x86_64'; assert platform.python_version().startswith('3.14.'); assert torch.__version__.split('+')[0]=='${TORCH_VERSION}'; assert torch.version.cuda=='13.0'; print('CUDA wheel/platform import passed. GPU execution remains unqualified.')"
FROM cuda-wheel-check AS runtime
WORKDIR /workspace/righelt
COPY . .
ARG SOURCE_REVISION
ARG NODE_IMAGE
ARG PYTHON_IMAGE
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
ARG TORCH_VERSION=2.14.1
ARG TARGET_PLATFORM=linux/amd64
ENV SOURCE_REVISION=${SOURCE_REVISION} NODE_IMAGE=${NODE_IMAGE} PYTHON_IMAGE=${PYTHON_IMAGE} TORCH_INDEX=${TORCH_INDEX} TORCH_VERSION=${TORCH_VERSION} TARGET_PLATFORM=${TARGET_PLATFORM}
RUN node tools/hosted-compute/image-identity.mjs \
    && pnpm install --frozen-lockfile \
    && /opt/righelt-python/bin/python -m pip install --only-binary=:all: -r tools/ai-trainer/requirements.lock \
    && /opt/righelt-python/bin/python -c "import torch; assert torch.version.cuda=='13.0'; assert torch.__version__.split('+')[0]=='${TORCH_VERSION}'" \
    && ln -s /opt/righelt-python tools/ai-trainer/.venv
ENV PATH=/opt/righelt-python/bin:$PATH
ENV PYTHONPATH=tools/ai-trainer
CMD ["node", "tools/hosted-compute/worker.mjs"]
