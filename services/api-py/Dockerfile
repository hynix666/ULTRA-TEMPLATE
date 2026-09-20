# The base image is pinned by digest as well as tag: a tag can be repointed at a different image.
# Dependabot updates both together.
FROM python:3.14-slim@sha256:caaf356f40667c496d405780745b9ac25771c189a51dfcc42430d531ea09f8a2
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src
# No runtime dependencies, so nothing is installed: the service is the standard library plus this
# source tree. A project that adds dependencies installs them here from the committed uv.lock.
# pip then leaves the image: nothing at runtime calls it, and it vendors packages of its own, with
# vulnerabilities of their own (the image scan found two there and nowhere else).
RUN python -m pip uninstall --yes --root-user-action=ignore pip
COPY src ./src
USER nobody
EXPOSE 8080
CMD ["python", "-m", "api_py.main"]
