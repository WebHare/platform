/* eslint-disable */
/*
  This file is based on filters.js in https://github.com/kig/canvasfilters, which is MIT licensed.

  - Added progress messages to monitor filter progress
  - Added posterize filter
  - Added adjust colors filter
  - Added RGB <-> YCbCr color conversions
  - Added equalize histogram and auto-contrast filters
*/
Filters = {};

if (typeof Float32Array == 'undefined') {
  Filters.getFloat32Array =
  Filters.getUint8Array = function(len) {
    if (len.length) {
      return len.slice(0);
    }
    return new Array(len);
  };
} else {
  Filters.getFloat32Array = function(len) {
    return new Float32Array(len);
  };
  Filters.getUint8Array = function(len) {
    return new Uint8Array(len);
  };
}

if (typeof document != 'undefined') {
  Filters.tmpCanvas = document.createElement('canvas');
  Filters.tmpCtx = Filters.tmpCanvas.getContext('2d');

  Filters.getPixels = function(img) {
    var c,ctx;
    if (img.getContext) {
      c = img;
      try { ctx = c.getContext('2d'); } catch(e) {}
    }
    if (!ctx) {
      c = this.getCanvas(img.width, img.height);
      ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
    }
    return ctx.getImageData(0,0,c.width,c.height);
  };

  Filters.createImageData = function(w, h) {
    return this.tmpCtx.createImageData(w, h);
  };

  Filters.getCanvas = function(w,h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };

  Filters.filterImage = function(filter, image, var_args) {
    var args = [this.getPixels(image)];
    for (var i=2; i<arguments.length; i++) {
      args.push(arguments[i]);
    }
    return filter.apply(this, args);
  };

  Filters.toCanvas = function(pixels) {
    var canvas = this.getCanvas(pixels.width, pixels.height);
    canvas.getContext('2d').putImageData(pixels, 0, 0);
    return canvas;
  };

  Filters.toImageData = function(pixels) {
    return this.identity(pixels);
  };

  Filters.updateProgress = function()
  {
    // No-op for inline
  };

} else {

  (function()
  {
    var imgdata = null;
    var progress = null;

    onmessage = function(e) {
      var ds = e.data;
      if (!ds.length) {
        ds = [ds];
      }
      imgdata = ds[0].output;
      progress = { tick: 0
                 , value: 0
                 , max: calculatePipeline(ds)
                 };
      var result = Filters.runPipeline(ds);
      postMessage({ type: "progress", progress: 100 });
      postMessage({ type: "result", result: result });
      progress = null;
      imgdata = null;
    };

    Filters.createImageData = function(w, h) {
      return imgdata || {width: w, height: h, data: this.getFloat32Array(w*h*4)};
    };

    Filters.updateProgress = function()
    {
      ++progress.value;
      if (progress.value>progress.max)
        throw progress.value+">"+progress.max;
      var tick = Math.round(Date.now() / 100); // Update at most every 100ms
      if (!progress.tick)
        progress.tick = tick;
      else if (tick > progress.tick)
      {
        progress.tick = tick;
        postMessage({ type: "progress", progress: Math.round(100 * progress.value / progress.max), value: progress.value, max: progress.max });
      }
    };

    function calculatePipeline(ds)
    {
      var total = Filters.identity_Order;
      for (var i = 0; i < ds.length; ++i)
      {
        total += Filters[ds[i].name + "_Order"];
      }
      total *= ds[0].args[0].width * ds[0].args[0].height;
      return total;
    }
  })();
}

Filters.runPipeline = function(ds) {
  var res = null;
  res = this[ds[0].name].apply(this, ds[0].args);
  for (var i=1; i<ds.length; i++) {
    var d = ds[i];
    var args = d.args.slice(0);
    args.unshift(res);
    res = this[d.name].apply(this, args);
  }
  return Filters.identity(res);
};

Filters.createImageDataFloat32 = function(w, h) {
  return {width: w, height: h, data: this.getFloat32Array(w*h*4)};
};

Filters.progressCountPixels = function(pixels) {
  return pixels.width * pixels.height;
};

Filters.identity_Order = 1;
Filters.identity = function(pixels, args) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  for (var i=0; i<d.length; i++) {
    dst[i] = d[i];
    if (i%4 == 0)
      Filters.updateProgress();
  }
  return output;
};

Filters.horizontalFlip_Order = 1;
Filters.horizontalFlip = function(pixels) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var w = pixels.width;
  var h = pixels.height;
  var dst = output.data;
  var d = pixels.data;
  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var off = (y*w+x)*4;
      var dstOff = (y*w+(w-x-1))*4;
      dst[dstOff] = d[off];
      dst[dstOff+1] = d[off+1];
      dst[dstOff+2] = d[off+2];
      dst[dstOff+3] = d[off+3];
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.verticalFlip_Order = 1;
Filters.verticalFlip = function(pixels) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var w = pixels.width;
  var h = pixels.height;
  var dst = output.data;
  var d = pixels.data;
  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var off = (y*w+x)*4;
      var dstOff = ((h-y-1)*w+x)*4;
      dst[dstOff] = d[off];
      dst[dstOff+1] = d[off+1];
      dst[dstOff+2] = d[off+2];
      dst[dstOff+3] = d[off+3];
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.luminance_Order = 1;
Filters.luminance = function(pixels, args) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  for (var i=0; i<d.length; i+=4) {
    var r = d[i];
    var g = d[i+1];
    var b = d[i+2];
    // CIE luminance for the RGB
    var v = 0.2126*r + 0.7152*g + 0.0722*b;
    dst[i] = dst[i+1] = dst[i+2] = v;
    dst[i+3] = d[i+3];
    Filters.updateProgress();
  }
  return output;
};

Filters.grayscale_Order = 1;
Filters.grayscale = function(pixels, args) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  for (var i=0; i<d.length; i+=4) {
    var r = d[i];
    var g = d[i+1];
    var b = d[i+2];
    var v = 0.3*r + 0.59*g + 0.11*b;
    dst[i] = dst[i+1] = dst[i+2] = v;
    dst[i+3] = d[i+3];
    Filters.updateProgress();
  }
  return output;
};

Filters.grayscaleAvg_Order = 1;
Filters.grayscaleAvg = function(pixels, args) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  var f = 1/3;
  for (var i=0; i<d.length; i+=4) {
    var r = d[i];
    var g = d[i+1];
    var b = d[i+2];
    var v = (r+g+b) * f;
    dst[i] = dst[i+1] = dst[i+2] = v;
    dst[i+3] = d[i+3];
    Filters.updateProgress();
  }
  return output;
};

Filters.sepiaTone_Order = 1;
Filters.sepiaTone = function(pixels, args)
{
  var output = Filters.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  for (var i = 0; i < d.length; i += 4)
  {
    var r = d[i], g = d[i + 1], b = d[i + 2];
    dst[i] =     Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
    dst[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
    dst[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
    dst[i + 3] = d[i + 3];
    Filters.updateProgress();
  }
  return output;
};

Filters.threshold_Order = 1;
Filters.threshold = function(pixels, threshold, high, low) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  if (high == null) high = 255;
  if (low == null) low = 0;
  var d = pixels.data;
  var dst = output.data;
  for (var i=0; i<d.length; i+=4) {
    var r = d[i];
    var g = d[i+1];
    var b = d[i+2];
    var v = (0.3*r + 0.59*g + 0.11*b >= threshold) ? high : low;
    dst[i] = dst[i+1] = dst[i+2] = v;
    dst[i+3] = d[i+3];
    Filters.updateProgress();
  }
  return output;
};

Filters.invert_Order = 1;
Filters.invert = function(pixels) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var d = pixels.data;
  var dst = output.data;
  for (var i=0; i<d.length; i+=4) {
    dst[i] = 255-d[i];
    dst[i+1] = 255-d[i+1];
    dst[i+2] = 255-d[i+2];
    dst[i+3] = d[i+3];
    Filters.updateProgress();
  }
  return output;
};

Filters.brightnessContrast_Order = Filters.applyLUT_Order;
Filters.brightnessContrast = function(pixels, brightness, contrast) {
  var lut = this.brightnessContrastLUT(brightness, contrast);
  return this.applyLUT(pixels, {r:lut, g:lut, b:lut, a:this.identityLUT()});
};

Filters.posterize_Order = Filters.applyLUT_Order;
Filters.posterize = function(pixels, level)
{
  var lut = this.posterizeLUT(level);
  return this.applyLUT(pixels, { r: lut, g: lut, b: lut, a: this.identityLUT() });
};

Filters.adjustColors_Order = Filters.applyLUT_Order;
Filters.adjustColors = function(pixels, rfrac, gfrac, bfrac)
{
  var rlut = this.adjustColorLUT(rfrac)
    , glut = this.adjustColorLUT(gfrac)
    , blut = this.adjustColorLUT(bfrac);
  return this.applyLUT(pixels, { r: rlut, g: glut, b: blut, a: this.identityLUT() });
};

Filters.applyLUT_Order = 1;
Filters.applyLUT = function(pixels, lut) {
  var output = Filters.createImageData(pixels.width, pixels.height);
  var d = pixels.data;
  var dst = output.data;
  var r = lut.r;
  var g = lut.g;
  var b = lut.b;
  var a = lut.a;
  for (var i=0; i<d.length; i+=4) {
    dst[i] = r[d[i]];
    dst[i+1] = g[d[i+1]];
    dst[i+2] = b[d[i+2]];
    dst[i+3] = a[d[i+3]];
    Filters.updateProgress();
  }
  return output;
};

Filters.createLUTFromCurve = function(points) {
  var lut = this.getUint8Array(256);
  var p = [0, 0];
  for (var i=0,j=0; i<lut.length; i++) {
    while (j < points.length && points[j][0] < i) {
      p = points[j];
      j++;
    }
    lut[i] = p[1];
  }
  return lut;
};

Filters.identityLUT = function() {
  var lut = this.getUint8Array(256);
  for (var i=0; i<lut.length; i++) {
    lut[i] = i;
  }
  return lut;
};

Filters.invertLUT = function() {
  var lut = this.getUint8Array(256);
  for (var i=0; i<lut.length; i++) {
    lut[i] = 255-i;
  }
  return lut;
};

Filters.brightnessContrastLUT = function(brightness, contrast) {
  var lut = this.getUint8Array(256);
  var contrastAdjust = -128*contrast + 128;
  var brightnessAdjust = 255 * brightness;
  var adjust = contrastAdjust + brightnessAdjust;
  for (var i=0; i<lut.length; i++) {
    var c = i*contrast + adjust;
    lut[i] = c < 0 ? 0 : (c > 255 ? 255 : c);
  }
  return lut;
};

Filters.posterizeLUT = function(level)
{
  var lut = this.getUint8Array(256);
  var colorSize = 256 / (level - 1);
  var stepSize = 256 / level;
  for (var l = 0; l < level; l++)
  {
    for (var step = 0; step < stepSize; step++)
    {
      var levelindex = Math.round(l * stepSize + step);
      if (l === level - 1)
      {
        lut[levelindex] = 255;
        continue;
      }
      lut[levelindex] = l * colorSize;
    }
  }
  return lut;
};

Filters.adjustColorLUT = function(fraction)
{
  var lut = this.getUint8Array(256);
  for (var i = 0; i < lut.length; ++i)
  {
    lut[i] = i * fraction;
  }
  return lut;
};

Filters.convolve_Order = 1;
Filters.convolve = function(pixels, weights, opaque) {
  var side = Math.round(Math.sqrt(weights.length));
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageData(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cy=0; cy<side; cy++) {
        for (var cx=0; cx<side; cx++) {
          var scy = Math.min(sh-1, Math.max(0, sy + cy - halfSide));
          var scx = Math.min(sw-1, Math.max(0, sx + cx - halfSide));
          var srcOff = (scy*sw+scx)*4;
          var wt = weights[cy*side+cx];
          r += src[srcOff] * wt;
          g += src[srcOff+1] * wt;
          b += src[srcOff+2] * wt;
          a += src[srcOff+3] * wt;
        }
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.verticalConvolve_Order = 1;
Filters.verticalConvolve = function(pixels, weightsVector, opaque) {
  var side = weightsVector.length;
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageData(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cy=0; cy<side; cy++) {
        var scy = Math.min(sh-1, Math.max(0, sy + cy - halfSide));
        var scx = sx;
        var srcOff = (scy*sw+scx)*4;
        var wt = weightsVector[cy];
        r += src[srcOff] * wt;
        g += src[srcOff+1] * wt;
        b += src[srcOff+2] * wt;
        a += src[srcOff+3] * wt;
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.horizontalConvolve_Order = 1;
Filters.horizontalConvolve = function(pixels, weightsVector, opaque) {
  var side = weightsVector.length;
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageData(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cx=0; cx<side; cx++) {
        var scy = sy;
        var scx = Math.min(sw-1, Math.max(0, sx + cx - halfSide));
        var srcOff = (scy*sw+scx)*4;
        var wt = weightsVector[cx];
        r += src[srcOff] * wt;
        g += src[srcOff+1] * wt;
        b += src[srcOff+2] * wt;
        a += src[srcOff+3] * wt;
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.separableConvolve_Order = Filters.horizontalConvolve_Order
                                + Filters.verticalConvolve_Order;
Filters.separableConvolve = function(pixels, horizWeights, vertWeights, opaque) {
  return this.horizontalConvolve(
    this.verticalConvolve(pixels, vertWeights, opaque),
    horizWeights, opaque
  );
};

Filters.convolveFloat32_Order = 1;
Filters.convolveFloat32 = function(pixels, weights, opaque) {
  var side = Math.round(Math.sqrt(weights.length));
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageDataFloat32(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cy=0; cy<side; cy++) {
        for (var cx=0; cx<side; cx++) {
          var scy = Math.min(sh-1, Math.max(0, sy + cy - halfSide));
          var scx = Math.min(sw-1, Math.max(0, sx + cx - halfSide));
          var srcOff = (scy*sw+scx)*4;
          var wt = weights[cy*side+cx];
          r += src[srcOff] * wt;
          g += src[srcOff+1] * wt;
          b += src[srcOff+2] * wt;
          a += src[srcOff+3] * wt;
        }
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};


Filters.verticalConvolveFloat32_Order = 1;
Filters.verticalConvolveFloat32 = function(pixels, weightsVector, opaque) {
  var side = weightsVector.length;
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageDataFloat32(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cy=0; cy<side; cy++) {
        var scy = Math.min(sh-1, Math.max(0, sy + cy - halfSide));
        var scx = sx;
        var srcOff = (scy*sw+scx)*4;
        var wt = weightsVector[cy];
        r += src[srcOff] * wt;
        g += src[srcOff+1] * wt;
        b += src[srcOff+2] * wt;
        a += src[srcOff+3] * wt;
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.horizontalConvolveFloat32_Order = 1;
Filters.horizontalConvolveFloat32 = function(pixels, weightsVector, opaque) {
  var side = weightsVector.length;
  var halfSide = Math.floor(side/2);

  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageDataFloat32(w, h);
  var dst = output.data;

  var alphaFac = opaque ? 1 : 0;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var r=0, g=0, b=0, a=0;
      for (var cx=0; cx<side; cx++) {
        var scy = sy;
        var scx = Math.min(sw-1, Math.max(0, sx + cx - halfSide));
        var srcOff = (scy*sw+scx)*4;
        var wt = weightsVector[cx];
        r += src[srcOff] * wt;
        g += src[srcOff+1] * wt;
        b += src[srcOff+2] * wt;
        a += src[srcOff+3] * wt;
      }
      dst[dstOff] = r;
      dst[dstOff+1] = g;
      dst[dstOff+2] = b;
      dst[dstOff+3] = a + alphaFac*(255-a);
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.separableConvolveFloat32_Order = Filters.horizontalConvolveFloat32_Order
                                       + Filters.verticalConvolveFloat32_Order;
Filters.separableConvolveFloat32 = function(pixels, horizWeights, vertWeights, opaque) {
  return this.horizontalConvolveFloat32(
    this.verticalConvolveFloat32(pixels, vertWeights, opaque),
    horizWeights, opaque
  );
};

Filters.gaussianBlur_Order = Filters.separableConvolve_Order;
Filters.gaussianBlur = function(pixels, diameter) {
  diameter = Math.abs(diameter);
  if (diameter <= 1) return Filters.identity(pixels);
  var radius = diameter / 2;
  var len = Math.ceil(diameter) + (1 - (Math.ceil(diameter) % 2))
  var weights = this.getFloat32Array(len);
  var rho = (radius+0.5) / 3;
  var rhoSq = rho*rho;
  var gaussianFactor = 1 / Math.sqrt(2*Math.PI*rhoSq);
  var rhoFactor = -1 / (2*rho*rho)
  var wsum = 0;
  var middle = Math.floor(len/2);
  for (var i=0; i<len; i++) {
    var x = i-middle;
    var gx = gaussianFactor * Math.exp(x*x*rhoFactor);
    weights[i] = gx;
    wsum += gx;
  }
  for (var i=0; i<weights.length; i++) {
    weights[i] /= wsum;
  }
  return Filters.separableConvolve(pixels, weights, weights, false);
};

Filters.laplaceKernel = Filters.getFloat32Array(
  [-1,-1,-1,
   -1, 8,-1,
   -1,-1,-1]);
Filters.laplace = function(pixels) {
  return Filters.convolve(pixels, this.laplaceKernel, true);
};

Filters.sobelSignVector = Filters.getFloat32Array([-1,0,1]);
Filters.sobelScaleVector = Filters.getFloat32Array([1,2,1]);

Filters.sobelVerticalGradient_Order = Filters.separableConvolveFloat32_Order;
Filters.sobelVerticalGradient = function(px) {
  return this.separableConvolveFloat32(px, this.sobelSignVector, this.sobelScaleVector);
};

Filters.sobelHorizontalGradient_Order = Filters.separableConvolveFloat32_Order;
Filters.sobelHorizontalGradient = function(px) {
  return this.separableConvolveFloat32(px, this.sobelScaleVector, this.sobelSignVector);
};

Filters.sobelVectors_Order = Filters.sobelVerticalGradient_Order
                           + Filters.sobelHorizontalGradient_Order
                           + 1;
Filters.sobelVectors = function(px) {
  var vertical = this.sobelVerticalGradient(px);
  var horizontal = this.sobelHorizontalGradient(px);
  var id = {width: vertical.width, height: vertical.height,
            data: this.getFloat32Array(vertical.width*vertical.height*8)};
  var vd = vertical.data;
  var hd = horizontal.data;
  var idd = id.data;
  for (var i=0,j=0; i<idd.length; i+=2,j++) {
    idd[i] = hd[j];
    idd[i+1] = vd[j];
    Filters.updateProgress();
  }
  return id;
};

Filters.sobel_Order = Filters.sobelVerticalGradient_Order
                    + Filters.sobelHorizontalGradient_Order
                    + 1;
Filters.sobel = function(px) {
  px = this.grayscale(px);
  var vertical = this.sobelVerticalGradient(px);
  var horizontal = this.sobelHorizontalGradient(px);
  var id = this.createImageData(vertical.width, vertical.height);
  for (var i=0; i<id.data.length; i+=4) {
    var v = Math.abs(vertical.data[i]);
    id.data[i] = v;
    var h = Math.abs(horizontal.data[i]);
    id.data[i+1] = h;
    id.data[i+2] = (v+h)/4;
    id.data[i+3] = 255;
    Filters.updateProgress();
  }
  return id;
};

Filters.bilinearSample = function (pixels, x, y, rgba) {
  var x1 = Math.floor(x);
  var x2 = Math.ceil(x);
  var y1 = Math.floor(y);
  var y2 = Math.ceil(y);
  var a = (x1+pixels.width*y1)*4;
  var b = (x2+pixels.width*y1)*4;
  var c = (x1+pixels.width*y2)*4;
  var d = (x2+pixels.width*y2)*4;
  var df = ((x-x1) + (y-y1));
  var cf = ((x2-x) + (y-y1));
  var bf = ((x-x1) + (y2-y));
  var af = ((x2-x) + (y2-y));
  var rsum = 1/(af+bf+cf+df);
  af *= rsum;
  bf *= rsum;
  cf *= rsum;
  df *= rsum;
  var data = pixels.data;
  rgba[0] = data[a]*af + data[b]*bf + data[c]*cf + data[d]*df;
  rgba[1] = data[a+1]*af + data[b+1]*bf + data[c+1]*cf + data[d+1]*df;
  rgba[2] = data[a+2]*af + data[b+2]*bf + data[c+2]*cf + data[d+2]*df;
  rgba[3] = data[a+3]*af + data[b+3]*bf + data[c+3]*cf + data[d+3]*df;
  return rgba;
};

Filters.distortSine_Order = 1;
Filters.distortSine = function(pixels, amount, yamount) {
  if (amount == null) amount = 0.5;
  if (yamount == null) yamount = amount;
  var output = this.createImageData(pixels.width, pixels.height);
  var dst = output.data;
  var d = pixels.data;
  var px = this.createImageData(1,1).data;
  for (var y=0; y<output.height; y++) {
    var sy = -Math.sin(y/(output.height-1) * Math.PI*2);
    var srcY = y + sy * yamount * output.height/4;
    srcY = Math.max(Math.min(srcY, output.height-1), 0);

    for (var x=0; x<output.width; x++) {
      var sx = -Math.sin(x/(output.width-1) * Math.PI*2);
      var srcX = x + sx * amount * output.width/4;
      srcX = Math.max(Math.min(srcX, output.width-1), 0);

      var rgba = this.bilinearSample(pixels, srcX, srcY, px);

      var off = (y*output.width+x)*4;
      dst[off] = rgba[0];
      dst[off+1] = rgba[1];
      dst[off+2] = rgba[2];
      dst[off+3] = rgba[3];
      Filters.updateProgress();
    }
  }
  return output;
};

Filters.darkenBlend_Order = 1;
Filters.darkenBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = a[i] < b[i] ? a[i] : b[i];
    dst[i+1] = a[i+1] < b[i+1] ? a[i+1] : b[i+1];
    dst[i+2] = a[i+2] < b[i+2] ? a[i+2] : b[i+2];
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.lightenBlend_Order = 1;
Filters.lightenBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = a[i] > b[i] ? a[i] : b[i];
    dst[i+1] = a[i+1] > b[i+1] ? a[i+1] : b[i+1];
    dst[i+2] = a[i+2] > b[i+2] ? a[i+2] : b[i+2];
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.multiplyBlend_Order = 1;
Filters.multiplyBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = (a[i]*b[i])*f;
    dst[i+1] = (a[i+1]*b[i+1])*f;
    dst[i+2] = (a[i+2]*b[i+2])*f;
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.screenBlend_Order = 1;
Filters.screenBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = a[i]+b[i]-a[i]*b[i]*f;
    dst[i+1] = a[i+1]+b[i+1]-a[i+1]*b[i+1]*f;
    dst[i+2] = a[i+2]+b[i+2]-a[i+2]*b[i+2]*f;
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.addBlend_Order = 1;
Filters.addBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = (a[i]+b[i]);
    dst[i+1] = (a[i+1]+b[i+1]);
    dst[i+2] = (a[i+2]+b[i+2]);
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.subBlend_Order = 1;
Filters.subBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = (a[i]+b[i]-255);
    dst[i+1] = (a[i+1]+b[i+1]-255);
    dst[i+2] = (a[i+2]+b[i+2]-255);
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.differenceBlend_Order = 1;
Filters.differenceBlend = function(below, above) {
  var output = Filters.createImageData(below.width, below.height);
  var a = below.data;
  var b = above.data;
  var dst = output.data;
  var f = 1/255;
  for (var i=0; i<a.length; i+=4) {
    dst[i] = Math.abs(a[i]-b[i]);
    dst[i+1] = Math.abs(a[i+1]-b[i+1]);
    dst[i+2] = Math.abs(a[i+2]-b[i+2]);
    dst[i+3] = a[i+3]+((255-a[i+3])*b[i+3])*f;
    Filters.updateProgress();
  }
  return output;
};

Filters.erode_Order = 1;
Filters.erode = function(pixels) {
  var src = pixels.data;
  var sw = pixels.width;
  var sh = pixels.height;

  var w = sw;
  var h = sh;
  var output = Filters.createImageData(w, h);
  var dst = output.data;

  for (var y=0; y<h; y++) {
    for (var x=0; x<w; x++) {
      var sy = y;
      var sx = x;
      var dstOff = (y*w+x)*4;
      var srcOff = (sy*sw+sx)*4;
      var v = 0;
      if (src[srcOff] == 0) {
        if (src[(sy*sw+Math.max(0,sx-1))*4] == 0 &&
            src[(Math.max(0,sy-1)*sw+sx)*4] == 0) {
            v = 255;
        }
      } else {
          v = 255;
      }
      dst[dstOff] = v;
      dst[dstOff+1] = v;
      dst[dstOff+2] = v;
      dst[dstOff+3] = 255;
      Filters.updateProgress();
    }
  }
  return output;
};

// Color conversion based on http://www.equasys.de/colorconversion.html

Filters.rgb2YCbCr_Order = 1;
Filters.rgb2YCbCr = function(pixels)
{
  var ycbcr = Filters.createImageData(pixels.width, pixels.height);
  var d = pixels.data;
  var dst = ycbcr.data;
  for (var i = 0; i < d.length; i += 4)
  {
    var r = d[i], g = d[i + 1], b = d[i + 2];
    dst[i] =           0.299 * r + 0.587 * g + 0.114 * b;
    dst[i + 1] = 128 - 0.169 * r - 0.331 * g + 0.500 * b;
    dst[i + 2] = 128 + 0.500 * r - 0.419 * g - 0.081 * b;
    dst[i + 3] = d[i + 3]; // Preserve alpha
    Filters.updateProgress();
  }
  return ycbcr;
};

Filters.ycbcr2RGB_Order = 1;
Filters.ycbcr2RGB = function(ycbcr)
{
  var output = Filters.createImageData(ycbcr.width, ycbcr.height);
  var d = ycbcr.data;
  var dst = output.data;
  for (var i = 0; i < dst.length; i += 4)
  {
    var y = d[i], cb = d[i + 1] - 128, cr = d[i + 2] - 128;
    dst[i] =     1.000 * y              + 1.400 * cr;
    dst[i + 1] = 1.000 * y - 0.343 * cb - 0.711 * cr;
    dst[i + 2] = 1.000 * y + 1.765 * cb;
    dst[i + 3] = d[i + 3]; // Preserve alpha
    Filters.updateProgress();
  }
  return output;
};

Filters.equalizeHistogram_Order = Filters.rgb2YCbCr_Order
                                + 1
                                + Filters.ycbcr2RGB_Order;
Filters.equalizeHistogram = function(pixels)
{
  // Equalize the histogram based on the intensity of the Y channel of the image in the YCbCr color space

  var ycbcr = Filters.rgb2YCbCr(pixels);
  var d = ycbcr.data;

  var hist = this.getFloat32Array(256);
  for (var i = 0; i < d.length; i += 4)
    ++hist[d[i]];
  var sum = d.length / 4;
  var prev = hist[0];
  for (i = 1; i < 256; ++i)
    prev = hist[i] += prev;
  var norm = 255 / sum;
  for (i = 0; i < d.length; i += 4)
  {
    d[i] = (hist[d[i]] * norm);
    Filters.updateProgress();
  }

  return Filters.ycbcr2RGB(ycbcr);
};

Filters.autoContrast_Order = Filters.rgb2YCbCr_Order
                           + 1
                           + Filters.ycbcr2RGB_Order;
Filters.autoContrast = function(pixels, percentile, upperpercentile)
{
  // Equalize the histogram based on the intensity of the Y channel of the image in the YCbCr color space
  // Algorithm based on http://stackoverflow.com/questions/9744255/instagram-lux-effect/9761841#9761841

  // Use 5th and 95th percentiles by default
  var lower = percentile || 5;
  var upper = upperpercentile || (100 - lower);

  var ycbcr = Filters.rgb2YCbCr(pixels);
  var d = ycbcr.data;

  var hist = this.getFloat32Array(256);
  for (var i = 0; i < d.length; i += 4)
    ++hist[d[i]];
  var sum = d.length / 4;
  lower = lower * sum / 100;
  upper = upper * sum / 100;
  var lowerperc = 0, upperperc = 0;
  var prev = hist[0];
  for (i = 1; i < 256; ++i)
  {
    prev = hist[i] += prev;
    if (prev <= lower)
      lowerperc = i;
    if (prev <= upper)
      upperperc = i;
  }
  var a = 255 / (upperperc - lowerperc);
  var b = -a * lowerperc;
  for (i = 0; i < d.length; i += 4)
  {
    d[i] = Math.floor(a * d[i] + b);
    Filters.updateProgress();
  }

  return Filters.ycbcr2RGB(ycbcr);
};

// For synchronous, non-worker usage
if (typeof require != 'undefined') {
  exports.Filters = Filters;
}
