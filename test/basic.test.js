const { Builder, Browser, By, Key, until } = require('selenium-webdriver')


//test('Test new map dialog display', async () => {
//  let driver = await new Builder().forBrowser(Browser.CHROME).build()
//
//  try {
//    await driver.get('http://localhost:8081/beta/')
//    const dialog = await driver.findElement(By.id('new_map_dialog'))
//
//    const opacityValueBefore = await dialog.getCssValue('opacity')
//    expect(opacityValueBefore).toBe("0")
//
//    await driver.findElement(By.id('new_map_btn')).click()
//    await driver.sleep(2000)
//
//    const opacityValueAfter = await dialog.getCssValue('opacity')
//    expect(opacityValueAfter).toBe("1")
//  } finally {
//    await driver.quit()
//  }
//});
//
//
//test('Initial map list is empty', async () => {
//  let driver = await new Builder().forBrowser(Browser.CHROME).build()
//
//  try {
//    await driver.get('http://localhost:8081/beta/')
//
//    const mapList = await driver.findElements(By.css('#map_list li'))
//
//    expect(mapList.length).toBe(0)
//
//  } finally {
//    await driver.quit()
//  }
//});


test('Map list correctly populated', async () => {
  let driver = await new Builder().forBrowser(Browser.CHROME).build()

  try {
    await driver.get('http://localhost:8081/beta/')

    const mapListBefore = await driver.findElements(By.css('#map_list li'))

    expect(mapListBefore.length).toBe(0)

    await driver.findElement(By.id('new_map_btn')).click()
    await driver.sleep(3000)
    await driver.findElement(By.css('#new_map_dialog input[name="map_name"]')).sendKeys('foobar')
    await driver.findElement(By.name('map_file')).sendKeys('/tmpimg.jpg')
    await driver.findElement(By.css('#new_map_dialog form button[value="submit"]')).click()

    await driver.sleep(1000)
    await driver.navigate().back()
    await driver.sleep(1000)

    const mapListAfter = await driver.findElements(By.css('#map_list li'))

    expect(mapListAfter.length).toBe(1)

  } finally {
    await driver.quit()
  }
});
