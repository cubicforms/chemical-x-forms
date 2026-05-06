<!--
  Inline-code chip — `<UiInlineCode>useForm</UiInlineCode>`.

  Pairs with the `inline-code` utility in `tailwind.css` (single
  source of truth for the chip's visual styling) and the
  `renderInlineCode` util (which emits the same chip for backtick-
  wrapped tokens inside data strings authored without a template).
-->
<template>
  <code class="inline-code"><slot /></code>
</template>
