<template>
  <div class="NotFound">
    <div class="NotFound__inner">
      <p class="NotFound__code" aria-hidden="true">404</p>
      <h1 class="NotFound__title">Page not found</h1>
      <p class="NotFound__lead">
        The page you're looking for has moved or was never here.
        You didn't do anything wrong.
      </p>

      <ul class="NotFound__links">
        <li><a href="/">Back to home</a></li>
        <li><a href="/guide/getting-started">Start the guide</a></li>
        <li><a href="/packages/core">Browse packages</a></li>
        <li><a href="/recipes/nextjs">Framework recipes</a></li>
        <li>
          <a href="https://github.com/real-a11y/real-a11y-dev/issues/new"
             rel="noopener">Report a broken link</a>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.NotFound {
  min-height: calc(100vh - var(--vp-nav-height, 64px));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.NotFound__inner {
  max-width: 560px;
  text-align: left;
}

.NotFound__code {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--vp-c-text-3);
  margin: 0 0 16px;
}

.NotFound__title {
  font-size: 48px;
  font-weight: 900;
  letter-spacing: -1px;
  line-height: 1.1;
  margin: 0 0 16px;
  color: var(--vp-c-text-1);
}

.NotFound__lead {
  font-size: 18px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
}

.NotFound__links {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--vp-c-divider);
}

.NotFound__links li {
  border-bottom: 1px solid var(--vp-c-divider);
}

.NotFound__links a {
  display: block;
  padding: 14px 0;
  color: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.15s ease, padding-left 0.15s ease;
}

.NotFound__links a:hover,
.NotFound__links a:focus-visible {
  color: var(--vp-c-brand-1);
  padding-left: 4px;
}

.NotFound__links a:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
