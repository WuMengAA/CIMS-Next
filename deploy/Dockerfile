# CIMS 集控后端镜像
# 放置位置：cims-src/Dockerfile（与 pyproject.toml 同级）
# 用法：见 docker-compose.yml（build.context=./cims-src）

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 编译依赖（pgpy / cryptography / grpc 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# 优先 uv（CIMS 工作流），否则 pip
COPY pyproject.toml uv.lock* ./
RUN pip install --no-cache-dir uv || true

# 安装依赖：uv 优先，回退 pip
RUN if [ -f uv.lock ]; then \
      uv sync --frozen --no-dev || uv sync --no-dev ; \
    else \
      pip install --no-cache-dir -e . ; \
    fi

COPY . .

EXPOSE 27044

# 启动：模块方式运行（三端口由配置决定）
# 若 CIMS 提供 `cims daemon` CLI，可替换为：CMD ["cims", "daemon"]
CMD ["sh", "-c", "python -m app"]
