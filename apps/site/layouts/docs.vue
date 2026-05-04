<template>
  <!-- 2-column shell: sidebar (lg+) + content area. The content area
       is what catch-all pages drop into via <slot />, and they
       further split it into article + TOC at xl+. The layout never
       constrains article width itself — that's a page concern, since
       the docs index uses a different content width than the
       catch-all article view. -->
  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <UiContainer size="xl">
      <div class="flex gap-12 pt-10 pb-20">
        <DocsSidebar />
        <div class="min-w-0 flex-1">
          <slot />
        </div>
      </div>
    </UiContainer>
    <AppFooter />
  </div>
</template>
