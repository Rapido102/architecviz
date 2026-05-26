import dagre from 'dagre';
import { Node, Edge, Position } from '@xyflow/react';

const NODE_WIDTH = 250;
const NODE_HEIGHT = 120;
const ENDPOINT_NODE_WIDTH = 200;
const ENDPOINT_NODE_HEIGHT = 36;

function nodeDims(node: Node) {
  return node.type === 'endpoint'
    ? { width: ENDPOINT_NODE_WIDTH, height: ENDPOINT_NODE_HEIGHT }
    : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });

  nodes.forEach((node) => {
    const { width, height } = nodeDims(node);
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const { width, height } = nodeDims(node);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
};
