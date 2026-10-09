<template>
  <!-- Git 分支图标（Element Plus 图标库未提供，使用内联 SVG） -->
  <svg
    class="git-icon"
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="4" cy="3.6" r="1.7" />
    <circle cx="4" cy="12.4" r="1.7" />
    <circle cx="12" cy="5.2" r="1.7" />
    <path d="M4 5.3v5.4" />
    <path d="M12 6.9v1.1c0 2.1-1.9 3.2-4 3.6" />
    <path d="M12 3.5c0 0-0.1 0-0.1 0" />
    <path d="M12 6.9C12 4.4 9.6 3.6 6.6 3.6" />
  </svg>
</template>

<style scoped>
.git-icon {
  display: inline-block;
  vertical-align: -0.125em;
}
</style>
