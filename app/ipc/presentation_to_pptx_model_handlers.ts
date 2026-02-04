import { ipcMain, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";

interface ElementAttributes {
  tagName: string;
  id?: string;
  className?: string;
  innerText?: string;
  opacity?: number;
  background?: {
    color?: string;
    opacity?: number;
  };
  border?: {
    color?: string;
    width?: number;
    opacity?: number;
  };
  shadow?: {
    offset?: [number, number];
    color?: string;
    opacity?: number;
    radius?: number;
    angle?: number;
    spread?: number;
    inset?: boolean;
  };
  font?: {
    name?: string;
    size?: number;
    weight?: number;
    color?: string;
    italic?: boolean;
  };
  position?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  margin?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  padding?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  zIndex?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  borderRadius?: number[];
  imageSrc?: string;
  objectFit?: "contain" | "cover" | "fill";
  clip?: boolean;
  overlay?: any;
  shape?: "rectangle" | "circle";
  connectorType?: any;
  textWrap?: boolean;
  should_screenshot?: boolean;
  filters?: {
    invert?: number;
    brightness?: number;
    contrast?: number;
    saturate?: number;
    hueRotate?: number;
    blur?: number;
    grayscale?: number;
    sepia?: number;
    opacity?: number;
  };
}

interface SlideAttributesResult {
  elements: ElementAttributes[];
  backgroundColor?: string;
  speakerNote?: string;
}

interface PptxSlide {
  elements: any[];
  backgroundColor?: string;
  speakerNote?: string;
}

interface PptxPresentationModel {
  slides: PptxSlide[];
}

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function setupPresentationToPptxModelHandlers() {
  ipcMain.handle(
    "presentation-to-pptx-model",
    async (event, presentationId: string) => {
      let window: BrowserWindow | null = null;

      try {
        const screenshotsDir = getScreenshotsDir();
        window = await createBrowserWindow(presentationId);

        const { slides, speakerNotes } = await getSlidesAndSpeakerNotes(window);
        const slides_attributes = await getSlidesAttributes(
          window,
          slides,
          screenshotsDir
        );
        await postProcessSlidesAttributes(
          window,
          slides_attributes,
          screenshotsDir,
          speakerNotes
        );
        const slides_pptx_models =
          convertElementAttributesToPptxSlides(slides_attributes);
        const presentation_pptx_model: PptxPresentationModel = {
          slides: slides_pptx_models,
        };

        window.close();

        return { success: true, data: presentation_pptx_model };
      } catch (error: any) {
        console.error(error);
        if (window) {
          window.close();
        }
        return {
          success: false,
          error: error.message,
          isApiError: error instanceof ApiError,
        };
      }
    }
  );
}

async function createBrowserWindow(
  presentationId: string
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Use the Next.js URL from environment variable
  const nextjsUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';
  const url = `${nextjsUrl}/pdf-maker?id=${presentationId}`;
  await window.loadURL(url);

  // Wait for page to be fully loaded and slides wrapper to be ready
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      if (document.getElementById('presentation-slides-wrapper')) {
        resolve();
      } else {
        const observer = new MutationObserver((mutations, obs) => {
          if (document.getElementById('presentation-slides-wrapper')) {
            obs.disconnect();
            resolve();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Timeout after 10 seconds
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 10000);
      }
    });
  `);

  // Small additional wait for images to load
  await new Promise((resolve) => setTimeout(resolve, 500));

  return window;
}

function getScreenshotsDir(): string {
  const tempDir = process.env.TEMP_DIRECTORY;
  if (!tempDir) {
    throw new ApiError("TEMP_DIRECTORY environment variable not set");
  }
  const screenshotsDir = path.join(tempDir, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  return screenshotsDir;
}

async function getSlidesAndSpeakerNotes(window: BrowserWindow) {
  try {
    const result = await window.webContents.executeJavaScript(`
      (function() {
        const slidesWrapper = document.getElementById('presentation-slides-wrapper');
        if (!slidesWrapper) {
          throw new Error('Presentation slides not found');
        }
        
        const speakerNotes = Array.from(slidesWrapper.querySelectorAll('[data-speaker-note]')).map(
          (el) => el.getAttribute('data-speaker-note') || ''
        );
        
        const slides = Array.from(slidesWrapper.querySelectorAll(':scope > div > div'));
        
        return {
          slidesCount: slides.length,
          speakerNotes: speakerNotes
        };
      })();
    `);

    return {
      slides: Array(result.slidesCount)
        .fill(null)
        .map((_, i) => i),
      speakerNotes: result.speakerNotes,
    };
  } catch (error) {
    console.error('Error executing JavaScript in slides page:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ApiError(`Failed to get slides data: ${errorMessage}`);
  }
}

async function getSlidesAttributes(
  window: BrowserWindow,
  slides: number[],
  screenshotsDir: string
): Promise<SlideAttributesResult[]> {
  const slideAttributes: SlideAttributesResult[] = [];

  for (const slideIndex of slides) {
    const attributes = await getAllChildElementsAttributes(
      window,
      slideIndex,
      screenshotsDir
    );
    slideAttributes.push(attributes);
  }

  return slideAttributes;
}

async function getAllChildElementsAttributes(
  window: BrowserWindow,
  slideIndex: number,
  screenshotsDir: string
): Promise<SlideAttributesResult> {
  try {
    const result = await window.webContents.executeJavaScript(`
      (function() {
        try {
          const slidesWrapper = document.getElementById('presentation-slides-wrapper');
          const slides = Array.from(slidesWrapper.querySelectorAll(':scope > div > div'));
          const slide = slides[${slideIndex}];
          
          if (!slide) {
            throw new Error('Slide not found at index ${slideIndex}');
          }
          
          ${getElementAttributesFunction()}
          
          function getAllChildElementsAttributesRecursive(element, rootRect, depth, inheritedFont, inheritedBackground, inheritedBorderRadius, inheritedZIndex, inheritedOpacity) {
        if (!rootRect) {
          const rootAttributes = getElementAttributes(element);
          inheritedFont = rootAttributes.font;
          inheritedBackground = rootAttributes.background;
          inheritedZIndex = rootAttributes.zIndex;
          inheritedOpacity = rootAttributes.opacity;
          rootRect = {
            left: rootAttributes.position?.left ?? 0,
            top: rootAttributes.position?.top ?? 0,
            width: rootAttributes.position?.width ?? 1280,
            height: rootAttributes.position?.height ?? 720,
          };
          depth = 0;
        }
        
        const directChildren = Array.from(element.children);
        const allResults = [];
        
        for (const child of directChildren) {
          const attributes = getElementAttributes(child);
          
          if (['style', 'script', 'link', 'meta', 'path'].includes(attributes.tagName)) {
            continue;
          }
          
          if (inheritedFont && !attributes.font && attributes.innerText && attributes.innerText.trim().length > 0) {
            attributes.font = inheritedFont;
          }
          if (inheritedBackground && !attributes.background && attributes.shadow) {
            attributes.background = inheritedBackground;
          }
          if (inheritedBorderRadius && !attributes.borderRadius) {
            attributes.borderRadius = inheritedBorderRadius;
          }
          if (inheritedZIndex !== undefined && attributes.zIndex === 0) {
            attributes.zIndex = inheritedZIndex;
          }
          if (inheritedOpacity !== undefined && (attributes.opacity === undefined || attributes.opacity === 1)) {
            attributes.opacity = inheritedOpacity;
          }
          
          if (attributes.position && attributes.position.left !== undefined && attributes.position.top !== undefined) {
            attributes.position = {
              left: attributes.position.left - rootRect.left,
              top: attributes.position.top - rootRect.top,
              width: attributes.position.width,
              height: attributes.position.height,
            };
          }
          
          if (!attributes.position || !attributes.position.width || !attributes.position.height || 
              attributes.position.width === 0 || attributes.position.height === 0) {
            continue;
          }
          
          if (attributes.tagName === 'p') {
            const innerElementTagNames = Array.from(child.querySelectorAll('*')).map((e) =>
              e.tagName.toLowerCase()
            );
            
            const allowedInlineTags = new Set(['strong', 'u', 'em', 'code', 's']);
            const hasOnlyAllowedInlineTags = innerElementTagNames.every((tag) =>
              allowedInlineTags.has(tag)
            );
            
            if (innerElementTagNames.length > 0 && hasOnlyAllowedInlineTags) {
              attributes.innerText = child.innerHTML;
              allResults.push({ attributes, depth });
              continue;
            }
          }
          
          if (attributes.tagName === 'svg' || attributes.tagName === 'canvas' || attributes.tagName === 'table') {
            attributes.should_screenshot = true;
            attributes.elementIndex = allResults.length;
          }
          
          allResults.push({ attributes, depth });
          
          if (attributes.should_screenshot && attributes.tagName !== 'svg') {
            continue;
          }
          
          const childResults = getAllChildElementsAttributesRecursive(
            child,
            rootRect,
            depth + 1,
            attributes.font || inheritedFont,
            attributes.background || inheritedBackground,
            attributes.borderRadius || inheritedBorderRadius,
            attributes.zIndex || inheritedZIndex,
            attributes.opacity || inheritedOpacity
          );
          
          allResults.push(...childResults.map((attr) => ({
            attributes: attr,
            depth: depth + 1,
          })));
        }
        
        return allResults;
      }
      
      const allResults = getAllChildElementsAttributesRecursive(slide, null, 0, undefined, undefined, undefined, undefined, undefined);
      const rootRect = {
        left: 0,
        top: 0,
        width: 1280,
        height: 720,
      };
      
      let backgroundColor = undefined;
      const elementsWithRootPosition = allResults.filter(({ attributes }) => {
        return (
          attributes.position &&
          attributes.position.left === 0 &&
          attributes.position.top === 0 &&
          attributes.position.width === rootRect.width &&
          attributes.position.height === rootRect.height
        );
      });
      
      for (const { attributes } of elementsWithRootPosition) {
        if (attributes.background && attributes.background.color) {
          backgroundColor = attributes.background.color;
          break;
        }
      }
      
      const filteredResults = allResults.filter(({ attributes }) => {
        const hasBackground = attributes.background && attributes.background.color;
        const hasBorder = attributes.border && attributes.border.color;
        const hasShadow = attributes.shadow && attributes.shadow.color;
        const hasText = attributes.innerText && attributes.innerText.trim().length > 0;
        const hasImage = attributes.imageSrc;
        const isSvg = attributes.tagName === 'svg';
        const isCanvas = attributes.tagName === 'canvas';
        const isTable = attributes.tagName === 'table';
        
        const occupiesRoot =
          attributes.position &&
          attributes.position.left === 0 &&
          attributes.position.top === 0 &&
          attributes.position.width === rootRect.width &&
          attributes.position.height === rootRect.height;
        
        const hasVisualProperties = hasBackground || hasBorder || hasShadow || hasText;
        const hasSpecialContent = hasImage || isSvg || isCanvas || isTable;
        
        return (hasVisualProperties && !occupiesRoot) || hasSpecialContent;
      });
      
      const sortedElements = filteredResults
        .sort((a, b) => {
          const zIndexA = a.attributes.zIndex || 0;
          const zIndexB = b.attributes.zIndex || 0;
          
          if (zIndexA === zIndexB) {
            return a.depth - b.depth;
          }
          
          return zIndexB - zIndexA;
        })
        .map(({ attributes }) => {
          if (attributes.shadow && attributes.shadow.color && 
              (!attributes.background || !attributes.background.color) && backgroundColor) {
            attributes.background = {
              color: backgroundColor,
              opacity: undefined,
            };
          }
          return attributes;
        });
      
      return {
        elements: sortedElements,
        backgroundColor: backgroundColor,
      };
        } catch (error) {
          console.error('Error in slide processing:', error);
          throw error;
        }
    })();
  `);

    return result;
  } catch (error) {
    console.error(`Error getting attributes for slide ${slideIndex}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ApiError(`Failed to analyze slide ${slideIndex}: ${errorMessage}`);
  }
}

function getElementAttributesFunction(): string {
  return `
    function getElementAttributes(el) {
      function colorToHex(color) {
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
          return { hex: undefined, opacity: undefined };
        }
        
        if (color.startsWith('rgba(') || color.startsWith('hsla(')) {
          const match = color.match(/rgba?\\(([^)]+)\\)|hsla?\\(([^)]+)\\)/);
          if (match) {
            const values = match[1] || match[2];
            const parts = values.split(',').map((part) => part.trim());
            
            if (parts.length >= 4) {
              const alpha = parseFloat(parts[3]);
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = color.replace(/,\\s*[\\d.]+\\)/, ')');
                const hexColor = ctx.fillStyle;
                const hex = hexColor.startsWith('#') ? hexColor.substring(1) : hexColor;
                return { hex, opacity: alpha };
              }
            }
          }
        }
        
        if (color.startsWith('rgb(') || color.startsWith('hsl(')) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = color;
            const hexColor = ctx.fillStyle;
            const hex = hexColor.startsWith('#') ? hexColor.substring(1) : hexColor;
            return { hex, opacity: undefined };
          }
        }
        
        if (color.startsWith('#')) {
          const hex = color.substring(1);
          return { hex, opacity: undefined };
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return { hex: color, opacity: undefined };
        
        ctx.fillStyle = color;
        const hexColor = ctx.fillStyle;
        const hex = hexColor.startsWith('#') ? hexColor.substring(1) : hexColor;
        return { hex, opacity: undefined };
      }
      
      function hasOnlyTextNodes(el) {
        const children = el.childNodes;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.nodeType === Node.ELEMENT_NODE) {
            return false;
          }
        }
        return true;
      }
      
      const computedStyles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      const position = {
        left: isFinite(rect.left) ? rect.left : 0,
        top: isFinite(rect.top) ? rect.top : 0,
        width: isFinite(rect.width) ? rect.width : 0,
        height: isFinite(rect.height) ? rect.height : 0,
      };
      
      const backgroundColorResult = colorToHex(computedStyles.backgroundColor);
      const background = backgroundColorResult.hex || backgroundColorResult.opacity !== undefined ? {
        color: backgroundColorResult.hex,
        opacity: backgroundColorResult.opacity,
      } : undefined;
      
      const borderColorResult = colorToHex(computedStyles.borderColor);
      const borderWidth = parseFloat(computedStyles.borderWidth);
      const border = borderWidth !== 0 && (borderColorResult.hex || borderColorResult.opacity !== undefined) ? {
        color: borderColorResult.hex,
        width: isNaN(borderWidth) ? undefined : borderWidth,
        opacity: borderColorResult.opacity,
      } : undefined;
      
      const fontSize = parseFloat(computedStyles.fontSize);
      const fontWeight = parseInt(computedStyles.fontWeight);
      const fontColorResult = colorToHex(computedStyles.color);
      const fontFamily = computedStyles.fontFamily;
      const fontStyle = computedStyles.fontStyle;
      
      let fontName = undefined;
      if (fontFamily !== 'initial') {
        const firstFont = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
        fontName = firstFont;
      }
      
      const font = fontName || !isNaN(fontSize) || !isNaN(fontWeight) || fontColorResult.hex || fontStyle === 'italic' ? {
        name: fontName,
        size: isNaN(fontSize) ? undefined : fontSize,
        weight: isNaN(fontWeight) ? undefined : fontWeight,
        color: fontColorResult.hex,
        italic: fontStyle === 'italic',
      } : undefined;
      
      const innerText = hasOnlyTextNodes(el) ? el.textContent || undefined : undefined;
      
      const zIndex = parseInt(computedStyles.zIndex);
      const zIndexValue = isNaN(zIndex) ? 0 : zIndex;
      
      const textAlign = computedStyles.textAlign;
      const objectFit = computedStyles.objectFit;
      
      const backgroundImage = computedStyles.backgroundImage;
      let parsedBackgroundImage;
      if (backgroundImage && backgroundImage !== 'none') {
        const urlMatch = backgroundImage.match(/url\\(['"]?([^'"]+)['"]?\\)/);
        if (urlMatch && urlMatch[1]) {
          parsedBackgroundImage = urlMatch[1];
        }
      }
      
      const imageSrc = el.src || parsedBackgroundImage;
      
      const borderRadius = computedStyles.borderRadius;
      let borderRadiusValue;
      if (borderRadius && borderRadius !== '0px') {
        const radiusParts = borderRadius.split(' ').map((part) => parseFloat(part));
        if (radiusParts.length === 1) {
          borderRadiusValue = [radiusParts[0], radiusParts[0], radiusParts[0], radiusParts[0]];
        } else if (radiusParts.length === 2) {
          borderRadiusValue = [radiusParts[0], radiusParts[1], radiusParts[0], radiusParts[1]];
        } else if (radiusParts.length === 3) {
          borderRadiusValue = [radiusParts[0], radiusParts[1], radiusParts[2], radiusParts[1]];
        } else if (radiusParts.length === 4) {
          borderRadiusValue = radiusParts;
        }
        
        if (borderRadiusValue) {
          const maxRadiusX = rect.width / 2;
          const maxRadiusY = rect.height / 2;
          borderRadiusValue = borderRadiusValue.map((radius, index) => {
            const maxRadius = index % 2 === 0 ? maxRadiusX : maxRadiusY;
            return Math.min(radius, maxRadius);
          });
        }
      }
      
      let shape = undefined;
      if (el.tagName.toLowerCase() === 'img') {
        shape = borderRadiusValue && borderRadiusValue.length === 4 && 
                borderRadiusValue.every((radius) => radius === 50) ? 'circle' : 'rectangle';
      }
      
      const opacity = parseFloat(computedStyles.opacity);
      const elementOpacity = isNaN(opacity) ? undefined : opacity;
      
      const textWrap = computedStyles.whiteSpace !== 'nowrap';
      
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id,
        className: el.className && typeof el.className === 'string' ? el.className : 
                   el.className ? el.className.toString() : undefined,
        innerText: innerText,
        opacity: elementOpacity,
        background: background,
        border: border,
        font: font,
        position: position,
        zIndex: zIndexValue,
        textAlign: textAlign !== 'left' ? textAlign : undefined,
        borderRadius: borderRadiusValue,
        imageSrc: imageSrc,
        objectFit: objectFit,
        shape: shape,
        textWrap: textWrap,
        should_screenshot: false,
      };
    }
  `;
}

async function postProcessSlidesAttributes(
  window: BrowserWindow,
  slidesAttributes: SlideAttributesResult[],
  screenshotsDir: string,
  speakerNotes: string[]
) {
  for (const [index, slideAttributes] of slidesAttributes.entries()) {
    for (const element of slideAttributes.elements) {
      if (element.should_screenshot) {
        const screenshotPath = await screenshotElement(
          window,
          index,
          element,
          screenshotsDir
        );
        element.imageSrc = screenshotPath;
        element.should_screenshot = false;
        element.objectFit = "cover";
      }
    }
    slideAttributes.speakerNote = speakerNotes[index];
  }
}

async function screenshotElement(
  window: BrowserWindow,
  slideIndex: number,
  element: ElementAttributes,
  screenshotsDir: string
): Promise<string> {
  const screenshotPath = path.join(
    screenshotsDir,
    `${uuidv4()}.png`
  ) as `${string}.png`;

  // For SVG elements, use convertSvgToPng
  if (element.tagName === "svg") {
    const svgHtml = await window.webContents.executeJavaScript(`
      (function() {
        const slidesWrapper = document.getElementById('presentation-slides-wrapper');
        const slides = Array.from(slidesWrapper.querySelectorAll(':scope > div > div'));
        const slide = slides[${slideIndex}];
        
        const allElements = Array.from(slide.querySelectorAll('*'));
        const svgElement = allElements.find((el) => {
          const rect = el.getBoundingClientRect();
          return el.tagName.toLowerCase() === 'svg' &&
                 Math.abs(rect.left - ${element.position!.left}) < 1 &&
                 Math.abs(rect.top - ${element.position!.top}) < 1 &&
                 Math.abs(rect.width - ${element.position!.width}) < 1 &&
                 Math.abs(rect.height - ${element.position!.height}) < 1;
        });
        
        if (svgElement) {
          const fontColor = window.getComputedStyle(svgElement).color;
          svgElement.style.color = fontColor;
          return svgElement.outerHTML;
        }
        
        return null;
      })();
    `);

    if (svgHtml) {
      const svgBuffer = Buffer.from(svgHtml);
      const pngBuffer = await sharp(svgBuffer)
        .resize(
          Math.round(element.position!.width!),
          Math.round(element.position!.height!)
        )
        .toFormat("png")
        .toBuffer();
      fs.writeFileSync(screenshotPath, pngBuffer);
      return screenshotPath;
    }
  }

  // For other elements (canvas, table), capture screenshot
  const rect = {
    x: element.position!.left,
    y: element.position!.top,
    width: element.position!.width,
    height: element.position!.height,
  };

  const screenshot = await window.webContents.capturePage(rect);
  fs.writeFileSync(screenshotPath, screenshot.toPNG());

  return screenshotPath;
}

function convertElementAttributesToPptxSlides(
  slidesAttributes: SlideAttributesResult[]
): PptxSlide[] {
  // This is a placeholder - you'll need to implement the actual conversion logic
  // based on your PPTX model requirements
  return slidesAttributes.map((slide) => ({
    elements: slide.elements.map((element) => ({
      ...element,
    })),
    backgroundColor: slide.backgroundColor,
    speakerNote: slide.speakerNote,
  }));
}
