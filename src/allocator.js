'use strict';

function usage(node, sessions) {
  const live = sessions.filter(s => s.nodeId === node.id && ['provisioning', 'running'].includes(s.status));
  return live.reduce((total, session) => ({
    cpu: total.cpu + session.resources.cpu,
    ram: total.ram + session.resources.ram,
    gpu: total.gpu + session.resources.gpu
  }), { cpu: 0, ram: 0, gpu: 0 });
}

function canFit(node, used, request) {
  return node.status === 'ready' &&
    used.cpu + request.cpu <= node.capacity.cpu &&
    used.ram + request.ram <= node.capacity.ram &&
    used.gpu + request.gpu <= node.capacity.gpu;
}

function selectNode(nodes, sessions, request) {
  const options = nodes
    .map(node => ({ node, used: usage(node, sessions) }))
    .filter(({ node, used }) => canFit(node, used, request))
    .map(({ node, used }) => {
      const cpu = (used.cpu + request.cpu) / node.capacity.cpu;
      const ram = (used.ram + request.ram) / node.capacity.ram;
      const gpu = node.capacity.gpu ? (used.gpu + request.gpu) / node.capacity.gpu : 0;
      return { node, score: 0.45 * cpu + 0.45 * ram + 0.10 * gpu };
    })
    .sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id));
  return options[0]?.node || null;
}

function resizeAllowed(node, sessions, session, nextResources) {
  const withoutCurrent = sessions.filter(item => item.id !== session.id);
  return canFit(node, usage(node, withoutCurrent), nextResources);
}

module.exports = { usage, canFit, selectNode, resizeAllowed };