# syntax = docker/dockerfile:experimental

FROM rastasheep/ubuntu-sshd:18.04

RUN echo "GatewayPorts yes" >> /etc/ssh/sshd_config
