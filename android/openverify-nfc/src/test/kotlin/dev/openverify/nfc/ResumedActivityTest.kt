package dev.openverify.nfc

import android.app.Activity
import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * C209.2: the route from an installed reader to the screen it reads for. The reader keeps the
 * application only, and follows which activity is resumed, so the SDK's flow activity is found
 * with no change to the SDK's API.
 */
@RunWith(RobolectricTestRunner::class)
class ResumedActivityTest {

    private val application: Application = ApplicationProvider.getApplicationContext()

    @Test
    fun `the resumed activity is known from its resume to its pause`() {
        val activities = ResumedActivity(application)
        assertNull(activities.current())

        val screen = Robolectric.buildActivity(Activity::class.java).create().start()
        assertNull(activities.current())
        screen.resume()
        assertSame(screen.get(), activities.current())
        screen.pause()
        assertNull(activities.current())
        screen.resume()
        assertSame(screen.get(), activities.current())
    }

    @Test
    fun `when one activity gives way to another, the one resumed last is the current one`() {
        val activities = ResumedActivity(application)
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        val second = Robolectric.buildActivity(Activity::class.java).create().start()

        // The platform resumes the new activity after pausing the old one; a late pause of the old one changes nothing.
        second.resume()
        assertSame(second.get(), activities.current())
        first.pause()
        assertSame(second.get(), activities.current())
    }

    @Test
    fun `each pause is told, with the activity that was left`() {
        val activities = ResumedActivity(application)
        val left = mutableListOf<Activity>()
        activities.onPaused = { left += it }
        val screen = Robolectric.buildActivity(Activity::class.java).setup()

        screen.pause()

        assertEquals(listOf<Activity>(screen.get()), left)
    }

    @Test
    fun `a context that is no application gives no activity, and nothing fails`() {
        assertNull(ResumedActivity(null).current())
    }
}
