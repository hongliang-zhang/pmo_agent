#!/bin/bash
source /etc/profile
cd "$(dirname "$0")"

set -ex

PROJECT=pmo-agent
VERSION=$(git rev-parse --short HEAD)
HARBOR=${TENCENT_REGISTRY:-maas-images-register.tencentcloudcr.com}
DOCKER_IMAGE=$HARBOR/wudao/$PROJECT:$VERSION
DOCKER_IMAGE_LATEST=$HARBOR/wudao/$PROJECT:latest
DOCKER_FILE=./Dockerfile

echo "当前环境为: ${DEPLOY_ENV:-dev-tx}"
echo "开始构建当次镜像:"
sudo docker build -t "$DOCKER_IMAGE" -f $DOCKER_FILE .
echo "构建成功"

echo "开始将镜像 push 到私服"
sudo docker push "$DOCKER_IMAGE"
sudo docker tag "$DOCKER_IMAGE" "$DOCKER_IMAGE_LATEST"
sudo docker push "$DOCKER_IMAGE_LATEST"
sudo docker rmi "$DOCKER_IMAGE" "$DOCKER_IMAGE_LATEST"

echo "发布完成: $DOCKER_IMAGE"
