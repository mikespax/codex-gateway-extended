import type useEmblaCarousel from "embla-carousel-vue";
import type { EmblaCarouselVueType } from "embla-carousel-vue";
import type { HTMLAttributes, Ref, UnwrapRef } from "vue";

type CarouselApi = EmblaCarouselVueType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

export type UnwrapRefCarouselApi = UnwrapRef<CarouselApi>;

export interface CarouselProps {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
}

export interface CarouselEmits {
  (e: "init-api", payload: UnwrapRefCarouselApi): void;
}

export interface CarouselState {
  carouselRef: EmblaCarouselVueType[0];
  carouselApi: EmblaCarouselVueType[1];
  canScrollPrev: Ref<boolean>;
  canScrollNext: Ref<boolean>;
  scrollPrev: () => void;
  scrollNext: () => void;
  orientation: CarouselProps["orientation"];
}

export interface WithClassAsProps {
  class?: HTMLAttributes["class"];
}
