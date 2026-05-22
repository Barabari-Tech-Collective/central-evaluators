import { queues } from '../queues/queueManager.js';

export async function routeEvaluation(payload) {

  const { type } = payload;

  switch(type) {

    case 'react':
      return queues.react.add('react-job', payload);

    case 'backend':
      return queues.backend.add('backend-job', payload);

    case 'visual':
      return queues.visual.add('visual-job', payload);

    case 'javascript':
      return queues.javascript.add('javascript-job', payload);

    case 'python':
      return queues.python.add('python-job', payload);

    case 'fullstack':
      return queues.fullstack.add('fullstack-job', payload);

    default:
      throw new Error('Invalid evaluator type');
  }
}