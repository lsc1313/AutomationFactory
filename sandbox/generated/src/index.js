import { requirements, externalActionsAllowed } from './spec.js';
export function buildPlan(){ return {requirements, externalActionsAllowed, status:'internal-build-ready'}; }
