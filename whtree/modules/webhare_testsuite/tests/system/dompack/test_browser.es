import * as test from "@mod-system/js/wh/testframework";
import * as browser from 'dompack/extra/browser.es';

test.registerTests(
[ "Browser detection"
, async function()
  {
    let useragent;
    useragent = browser.parseUserAgent('Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.32 (KHTML, like Gecko) Version/11.0 Mobile/15A337 Safari/604.1');
    test.eq("safari", useragent.name);
    test.eq(11, useragent.version);
    test.eq("ios", useragent.platform);
    test.eq("tablet", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (iPad; CPU OS 11_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/1.6.4b18.08.14.13 Mobile/15G77 Safari/605.1.15 _id/000007');
    test.eq("safari", useragent.name);
    test.eq(11, useragent.version);
    test.eq("ios", useragent.platform);
    test.eq("tablet", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/17.17134');
    test.eq("edge", useragent.name);
    test.eq(17, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/4.0 (compatible; MSIE 5.5; Windows 95; BCD2000)');
    test.eq("ie", useragent.name);
    test.eq(5, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.3; WOW64; Trident/7.0; .NET4.0E; .NET4.0C; .NET CLR 3.5.30729; .NET CLR 2.0.50727; .NET CLR 3.0.30729; Microsoft Outlook 16.0.4705; ms-office; MSOffice 16)');
    test.eq("ie", useragent.name);
    test.eq(7, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Android 7.0; Mobile; rv:56.0) Gecko/56.0 Firefox/56.0');
    test.eq("firefox", useragent.name);
    test.eq(56, useragent.version);
    test.eq("android", useragent.platform);
    test.eq("mobile", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Android 7.0; Tablet; rv:62.0) Gecko/62.0 Firefox/62.0');
    test.eq("firefox", useragent.name);
    test.eq(62, useragent.version);
    test.eq("android", useragent.platform);
    test.eq("mobile", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_3 like Mac OS X) AppleWebKit/603.3.8 (KHTML, like Gecko) Version/10.0 Mobile/14G60 Safari/602.1');
    test.eq("safari", useragent.name);
    test.eq(10, useragent.version);
    test.eq("ios", useragent.platform);
    test.eq("mobile", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Linux; Android 4.1.2; GT-I8730 Build/JZO54K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.91 Mobile Safari/537.36');
    test.eq("chrome", useragent.name);
    test.eq(68, useragent.version);
    test.eq("android", useragent.platform);
    test.eq("mobile", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Linux; Android 8.0.0; SAMSUNG SM-N950F/N950FXXU3CRCB Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/7.4 Chrome/59.0.3071.125 Mobile Safari/537.36');
    test.eq("chrome", useragent.name);
    test.eq(59, useragent.version);
    test.eq("android", useragent.platform);
    test.eq("mobile", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.10; rv:59.0) Gecko/20100101 Firefox/59.0');
    test.eq("firefox", useragent.name);
    test.eq(59, useragent.version);
    test.eq("mac", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36');
    test.eq("chrome", useragent.name);
    test.eq(69, useragent.version);
    test.eq("mac", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:62.0) Gecko/20100101 Firefox/62.0');
    test.eq("firefox", useragent.name);
    test.eq(62, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.81 Safari/537.36');
    test.eq("chrome", useragent.name);
    test.eq(69, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko');
    test.eq("ie", useragent.name);
    test.eq(11, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.91 Safari/537.36');
    test.eq("chrome", useragent.name);
    test.eq(69, useragent.version);
    test.eq("linux", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:62.0) Gecko/20100101 Firefox/62.0');
    test.eq("firefox", useragent.name);
    test.eq(62, useragent.version);
    test.eq("linux", useragent.platform);
    test.eq("desktop", useragent.device);

    useragent = browser.parseUserAgent('Opera/9.80 (Windows NT 5.1; U; MRA 5.10 (build 5196); ru) Presto/2.10.229 Version/11.61');
    test.eq("opera", useragent.name);
    test.eq(11, useragent.version);
    test.eq("windows", useragent.platform);
    test.eq("desktop", useragent.device);
  }
]);



