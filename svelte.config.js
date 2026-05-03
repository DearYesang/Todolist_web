import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    kit: {
        adapter: adapter({
            runtime: 'nodejs24.x',
            regions: ['hnd1']
        })
    }
};

export default config;
