const isProductionBuild = process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH === 'main';

if (!isProductionBuild) {
  console.error('Deploy remoto bloqueado: este comando só pode rodar no Workers Builds para a branch main.');
  process.exit(1);
}
